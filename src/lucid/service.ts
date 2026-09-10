import { createHash } from "node:crypto";
import { PaymentJournal, paymentContext, type PaymentIntent } from "./payment-journal";
import { a2a } from "@lucid-agents/a2a";
import { createAgent } from "@lucid-agents/core";
import { createAgentApp } from "@lucid-agents/hono";
import { http } from "@lucid-agents/http";
import { payments } from "@lucid-agents/payments";
import type { Hono } from "hono";
import type { ServiceConfig } from "../config";
import {
  atomicToDecimal,
  KeeperHubHttpExecutor,
} from "../keeperhub/http-executor";
import { SettlementCoordinator } from "../settlement/coordinator";
import { SqliteSettlementStore } from "../settlement/sqlite-store";
import { parsePaymentEvidence } from "../x402/payment-evidence";
import {
  auditBaseSepoliaReceipts,
  receiptAuditInputSchema,
  receiptAuditOutputSchema,
} from "./receipt-audit";
import { SettlementWatcher } from "./settlement-watcher";
import { SqliteTaskStore } from "./sqlite-task-store";

const ENTRYPOINT = "audit_receipts";
const NETWORK = "eip155:84532" as const;

interface TaskCreationBody {
  skillId?: string;
  message?: { content?: { text?: string } };
}

function parseEntrypointInput(body: TaskCreationBody): unknown {
  const text = body.message?.content?.text;
  if (typeof text !== "string") throw new Error("Task request omitted message text");
  return JSON.parse(text) as unknown;
}

export async function createSettlementAgentService(config: ServiceConfig) {
  const journal = new PaymentJournal(config.databasePath);
  const taskStore = new SqliteTaskStore({
    databasePath: config.databasePath,
    maxTasks: 2_000,
    retentionMs: 7 * 24 * 60 * 60 * 1_000,
  });
  const settlementStore = new SqliteSettlementStore(config.databasePath);
  const keeperHub = new KeeperHubHttpExecutor({
    apiKey: config.keeperHubApiKey,
    baseUrl: config.keeperHubApiBaseUrl,
  });
  const coordinator = new SettlementCoordinator({
    store: settlementStore,
    executor: keeperHub,
    settlementAddress: config.settlementAddress,
    usdcAddress: config.baseSepoliaUsdcAddress,
    pollIntervalMs: 2_000,
    maxPollAttempts: 30,
  });
  const watcher = new SettlementWatcher({
    coordinator,
    settlementStore,
    taskStore,
  });

  // Observe the trusted facilitator response before Lucid can return it to a
  // client. AsyncLocalStorage binds concurrent requests to their own intent.
  const originalFetch = globalThis.fetch;
  const observedFetch: typeof fetch = async (input, init) => {
    const capture = paymentContext.getStore();
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const response = await originalFetch(input, init);
    if (capture?.journal === journal && url === `${config.facilitatorUrl.replace(/\/$/, "")}/settle`) {
      const body = await response.clone().json().catch(() => null) as Record<string, unknown> | null;
      if (response.ok && body?.success === true) {
        journal.update(capture.operationId, { payment: parsePaymentEvidence({
          paymentResponseHeader: Buffer.from(JSON.stringify(body)).toString("base64"),
          expectedNetwork: NETWORK, expectedAssetAddress: config.baseSepoliaUsdcAddress,
          expectedAmountAtomic: config.taskPriceAtomic, settlementAddress: config.settlementAddress,
        }) });
      }
    }
    return response;
  };
  globalThis.fetch = observedFetch;

  try {
  const runtime = await createAgent({
    name: "Lucid Settlement Recovery",
    version: "0.1.0",
    description:
      "A paid receipt-audit task whose USDC is released or refunded only after deterministic verification through KeeperHub.",
  })
    .use(
      a2a({
        tasks: {
          store: taskStore,
          maxTasks: 2_000,
          retentionMs: 7 * 24 * 60 * 60 * 1_000,
          maxRunMs: config.taskDeadlineMs,
        },
      }),
    )
    .use(
      payments({
        agentId: "lucid-keeperhub-settlement",
        config: {
          payTo: config.settlementAddress,
          network: NETWORK,
          facilitatorUrl: config.facilitatorUrl,
          facilitatorAuth: config.facilitatorAuth,
          storage: { type: "in-memory" },
        },
      }),
    )
    .use(http({ basePath: "/api/agent" }))
    .addEntrypoint({
      key: ENTRYPOINT,
      description:
        "Independently checks up to 20 Base Sepolia transaction receipts. Every receipt must exist and have status 1 for the worker payout to be released.",
      paymentProtocol: "x402",
      x402: {
        offers: [
          {
            scheme: "exact",
            network: NETWORK,
            payTo: config.settlementAddress,
            facilitatorUrl: config.facilitatorUrl,
            // A money string lets Lucid's x402 EVM server attach the default
            // Base Sepolia USDC EIP-712 domain (name/version) required by
            // current buyers. An explicit token amount loses that metadata.
            price: `$${atomicToDecimal(config.taskPriceAtomic)}`,
          },
        ],
      },
      input: receiptAuditInputSchema,
      output: receiptAuditOutputSchema,
      metadata: {
        tags: ["receipts", "base-sepolia", "x402", "keeperhub"],
        settlement: "post-fulfillment",
      },
      handler: async ({ input, signal }) => ({
        output: await auditBaseSepoliaReceipts(
          input,
          config.baseSepoliaRpcUrl,
          signal,
        ),
      }),
    })
    .build();

  const { app } = await createAgentApp(runtime, {
    beforeMount(app) {
      mountSettlementCapture(app, {
        config,
        coordinator,
        watcher,
        journal,
      });
    },
    afterMount(app) {
      app.get("/api/settlements", async (context) =>
        context.json({ operations: await settlementStore.listAll() }),
      );
      app.get("/api/settlements/:operationId", async (context) => {
        const operation = await settlementStore.get(
          context.req.param("operationId"),
        );
        return operation
          ? context.json(operation)
          : context.json({ error: "Settlement operation not found" }, 404);
      });
    },
  });

  for (const intent of journal.pending()) {
    if (intent.payment && intent.taskId) {
      await captureIntent(intent, { coordinator, watcher, journal });
    } else {
      console.warn(`[settlement:reconciliation] ${intent.operationId}: payment outcome unknown; automatic resubmission blocked`);
    }
  }
  const recovered = await watcher.recover();
  if (recovered > 0) {
    console.info(`[settlement:recovery] resumed ${recovered} operation(s)`);
  }

  return {
    app,
    runtime,
    settlementStore,
    taskStore,
    coordinator,
    watcher,
    journal,
    async close() {
      watcher.close();
      await runtime.close();
      settlementStore.close();
      journal.close();
      if (globalThis.fetch === observedFetch) globalThis.fetch = originalFetch;
    },
  };
  } catch (error) {
    watcher.close();
    taskStore.close();
    settlementStore.close();
    journal.close();
    if (globalThis.fetch === observedFetch) globalThis.fetch = originalFetch;
    throw error;
  }
}

async function captureIntent(
  intent: PaymentIntent,
  dependencies: { coordinator: SettlementCoordinator; watcher: SettlementWatcher; journal: PaymentJournal },
): Promise<void> {
  if (!intent.payment || !intent.taskId) return;
  await dependencies.coordinator.reserve({
    task: { operationId: intent.operationId, lucidTaskId: intent.taskId, lucidRunId: intent.taskId,
      entrypoint: intent.entrypoint, reservedAt: intent.reservedAt, deadlineAt: intent.deadlineAt },
    payment: intent.payment, workerAddress: intent.workerAddress,
  });
  dependencies.journal.update(intent.operationId, {state: "captured"});
  dependencies.watcher.watch(intent.operationId);
}

function mountSettlementCapture(
  app: Hono,
  dependencies: {
    config: ServiceConfig;
    coordinator: SettlementCoordinator;
    watcher: SettlementWatcher;
    journal: PaymentJournal;
  },
): void {
  app.use("/api/agent/tasks", async (context, next) => {
    if (context.req.method !== "POST") return next();
    let input: ReturnType<typeof receiptAuditInputSchema.parse>;
    let body: TaskCreationBody;
    try {
      body = await context.req.raw.clone().json() as TaskCreationBody;
      if (body.skillId !== ENTRYPOINT) return next();
      input = receiptAuditInputSchema.parse(parseEntrypointInput(body));
      if (context.req.header("Idempotency-Key")?.trim() !== input.operationId) {
        return context.json({ error: "operationId must match Idempotency-Key" }, 400);
      }
    } catch { return context.json({error: "Invalid task input"}, 400); }
    const digest = (value: string) => createHash("sha256").update(value).digest("hex");
    const owner = context.req.header("Task-Access-Token") ?? "";
    const requestDigest = digest(JSON.stringify(input));
    const previous = dependencies.journal.get(input.operationId);
    if (previous) {
      if (!owner || previous.ownerDigest !== digest(owner) || previous.requestDigest !== requestDigest) {
        return context.json({error: {code: "operation_conflict", message: "Operation already exists with different credentials or input."}}, 409);
      }
      // Replay never passes the request to x402 again, even after a restart.
      if (previous.state === "captured" && previous.taskId) {
        context.header("X-Settlement-Operation", input.operationId);
        context.header("X-Settlement-Replayed", "true");
        return context.json({taskId: previous.taskId, accessToken: owner, status: "running"});
      }
      return context.json({error: {code: "reconciliation_required", message: "Payment attempt recorded. Inspect its journal before retrying; no new payment was sent."}}, 409);
    }
    const signed = context.req.header("PAYMENT-SIGNATURE") ?? context.req.header("X-PAYMENT");
    // An unsigned challenge cannot transfer funds; do not reserve its ID.
    if (!signed || !owner) return next();
    const now = new Date();
    dependencies.journal.begin({operationId: input.operationId, requestDigest,
      ownerDigest: digest(owner), entrypoint: ENTRYPOINT,
      workerAddress: input.workerAddress.toLowerCase() as `0x${string}`,
      reservedAt: now.toISOString(), deadlineAt: new Date(now.getTime() + dependencies.config.taskDeadlineMs).toISOString(),
      state: "pending"});
    await paymentContext.run({journal: dependencies.journal, operationId: input.operationId}, next);
    try {
      const intent = dependencies.journal.get(input.operationId)!;
      await captureIntent(intent, dependencies);
      context.header("X-Settlement-Operation", input.operationId);
      if (!intent.payment || !intent.taskId) context.header("X-Settlement-Capture", "reconciliation-required");
    } catch {
      console.error(`[settlement:capture] ${input.operationId}: reconciliation required`);
      context.header("X-Settlement-Capture", "reconciliation-required");
    }
  });
}
