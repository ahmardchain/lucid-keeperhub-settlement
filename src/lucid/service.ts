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

interface TaskCreationResponse {
  taskId?: string;
  accessToken?: string;
  status?: string;
}

function parseEntrypointInput(body: TaskCreationBody): unknown {
  const text = body.message?.content?.text;
  if (typeof text !== "string") throw new Error("Task request omitted message text");
  return JSON.parse(text) as unknown;
}

export async function createSettlementAgentService(config: ServiceConfig) {
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
    async close() {
      watcher.close();
      await runtime.close();
      settlementStore.close();
    },
  };
}

function mountSettlementCapture(
  app: Hono,
  dependencies: {
    config: ServiceConfig;
    coordinator: SettlementCoordinator;
    watcher: SettlementWatcher;
  },
): void {
  app.use("/api/agent/tasks", async (context, next) => {
    if (context.req.method !== "POST") return next();
    const request = context.req.raw.clone();
    const requestBodyPromise = request.json() as Promise<TaskCreationBody>;
    await next();

    const paymentResponseHeader =
      context.res.headers.get("PAYMENT-RESPONSE") ??
      context.res.headers.get("X-PAYMENT-RESPONSE");
    if (!context.res.ok || !paymentResponseHeader) return;

    try {
      const [requestBody, responseBody] = await Promise.all([
        requestBodyPromise,
        context.res.clone().json() as Promise<TaskCreationResponse>,
      ]);
      if (requestBody.skillId !== ENTRYPOINT || !responseBody.taskId) return;
      const input = receiptAuditInputSchema.parse(
        parseEntrypointInput(requestBody),
      );
      const idempotencyKey = request.headers.get("Idempotency-Key")?.trim();
      if (idempotencyKey !== input.operationId) {
        throw new Error(
          "Task operationId must exactly match the Lucid Idempotency-Key",
        );
      }

      const reservedAt = new Date();
      await dependencies.coordinator.reserve({
        task: {
          operationId: input.operationId,
          lucidTaskId: responseBody.taskId,
          lucidRunId: responseBody.taskId,
          entrypoint: ENTRYPOINT,
          reservedAt: reservedAt.toISOString(),
          deadlineAt: new Date(
            reservedAt.getTime() + dependencies.config.taskDeadlineMs,
          ).toISOString(),
        },
        payment: parsePaymentEvidence({
          paymentResponseHeader,
          expectedNetwork: NETWORK,
          expectedAssetAddress: dependencies.config.baseSepoliaUsdcAddress,
          expectedAmountAtomic: dependencies.config.taskPriceAtomic,
          settlementAddress: dependencies.config.settlementAddress,
        }),
        workerAddress: input.workerAddress.toLowerCase() as `0x${string}`,
      });
      dependencies.watcher.watch(input.operationId);

      const decorated = new Response(context.res.body, context.res);
      decorated.headers.set("X-Settlement-Operation", input.operationId);
      context.res = decorated;
    } catch (error) {
      // Payment is already committed at this point. Preserve Lucid's task
      // capability and receipt; the settlement wallet keeps funds recoverable.
      console.error("[settlement:capture] paid task needs reconciliation", error);
      const decorated = new Response(context.res.body, context.res);
      decorated.headers.set("X-Settlement-Capture", "reconciliation-required");
      context.res = decorated;
    }
  });
}
