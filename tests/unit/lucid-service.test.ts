import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { ServiceConfig } from "../../src/config";
import { createSettlementAgentService } from "../../src/lucid/service";

const SETTLEMENT = `0x${"11".repeat(20)}` as `0x${string}`;
const WORKER = `0x${"22".repeat(20)}` as `0x${string}`;
const PAYER = `0x${"33".repeat(20)}`;
const USDC = "0x036cbd53842c5426634e7929541ec2318f3dcf7e" as const;
const PAYMENT_TX = `0x${"44".repeat(32)}`;
const REFUND_PAYMENT_TX = `0x${"45".repeat(32)}`;
const AUDITED_TX = `0x${"55".repeat(32)}`;
const MISSING_TX = `0x${"56".repeat(32)}`;
const PAYOUT_TX = `0x${"66".repeat(32)}`;
const REFUND_TX = `0x${"67".repeat(32)}`;
const OPERATION_ID = "receipt-audit-2026-09-07-0001";
const REFUND_OPERATION_ID = "receipt-audit-2026-09-07-0002";

function paymentSignature(challengeResponse: Response, operationId: string): string {
  const required = challengeResponse.headers.get("PAYMENT-REQUIRED");
  assert.ok(required);
  const challenge = JSON.parse(
    Buffer.from(required, "base64").toString("utf8"),
  ) as {
    x402Version: number;
    resource: Record<string, unknown>;
    accepts: Array<Record<string, unknown>>;
  };
  assert.deepEqual(challenge.accepts[0]?.extra, {
    name: "USDC",
    version: "2",
  });
  return Buffer.from(
    JSON.stringify({
      x402Version: challenge.x402Version,
      resource: challenge.resource,
      accepted: challenge.accepts[0],
      payload: {
        signature: `integration-test-signature:${operationId}`,
        authorization: { from: PAYER },
      },
    }),
  ).toString("base64");
}

async function waitForTerminal(
  app: { fetch: (request: Request) => Response | Promise<Response> },
  operationId: string,
): Promise<Record<string, unknown>> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const response = await app.fetch(
      new Request(
        `http://localhost/api/settlements/${encodeURIComponent(operationId)}`,
      ),
    );
    if (response.ok) {
      const operation = (await response.json()) as Record<string, unknown>;
      if (["paid", "refunded", "blocked", "settlement_failed"].includes(String(operation.state))) return operation;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail(`settlement ${operationId} did not become terminal`);
}

test("real Lucid paid tasks payout and refund only after KeeperHub receipt verification", async () => {
  const directory = mkdtempSync(join(tmpdir(), "lucid-service-"));
  const originalFetch = globalThis.fetch;
  const keeperHubWrites: Array<Record<string, unknown>> = [];
  let paymentSettlementCount = 0;

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    const url = new URL(request.url);

    if (url.hostname === "facilitator.test" && url.pathname.endsWith("/supported")) {
      return Response.json({
        kinds: [
          {
            x402Version: 2,
            scheme: "exact",
            network: "eip155:84532",
            asset: {
              address: USDC,
              decimals: 6,
              eip712: { name: "USDC", version: "2" },
            },
          },
        ],
      });
    }
    if (url.hostname === "facilitator.test" && url.pathname.endsWith("/verify")) {
      return Response.json({ isValid: true, payer: PAYER });
    }
    if (url.hostname === "facilitator.test" && url.pathname.endsWith("/settle")) {
      paymentSettlementCount += 1;
      return Response.json({
        success: true,
        payer: PAYER,
        transaction:
          paymentSettlementCount === 1 ? PAYMENT_TX : REFUND_PAYMENT_TX,
        network: "eip155:84532",
        amount: "10000",
      });
    }
    if (url.hostname === "base-sepolia-rpc.test") {
      const body = (await request.json()) as {
        id: number;
        method: string;
        params?: unknown[];
      };
      if (body.method === "eth_chainId") {
        return Response.json({ jsonrpc: "2.0", id: body.id, result: "0x14a34" });
      }
      if (body.params?.[0] === MISSING_TX) {
        return Response.json({ jsonrpc: "2.0", id: body.id, result: null });
      }
      return Response.json({
        jsonrpc: "2.0",
        id: body.id,
        result: {
          transactionHash: AUDITED_TX,
          status: "0x1",
          blockNumber: "0x123",
          gasUsed: "0x5208",
        },
      });
    }
    if (url.hostname === "keeperhub.test") {
      if (url.pathname === "/api/execute/transfer") {
        const body = (await request.json()) as Record<string, unknown>;
        if (body.simulate === true) {
          return Response.json({
            success: true,
            status: "simulated",
            from: SETTLEMENT,
            to: USDC,
            value: "0",
            gasEstimate: "65124",
            wouldRevert: false,
          });
        }
        keeperHubWrites.push(body);
        const refund = body.recipientAddress === PAYER;
        assert.equal(
          request.headers.get("Idempotency-Key"),
          refund
            ? `lucid-settlement:v1:${REFUND_OPERATION_ID}:refund`
            : `lucid-settlement:v1:${OPERATION_ID}:payout`,
        );
        return Response.json(
          {
            executionId: refund
              ? "direct_integration_refund"
              : "direct_integration_payout",
            status: "completed",
          },
          { status: 202 },
        );
      }
      if (url.pathname.endsWith("/status")) {
        const refund = url.pathname.includes("direct_integration_refund");
        const transactionHash = refund ? REFUND_TX : PAYOUT_TX;
        return Response.json({
          executionId: refund
            ? "direct_integration_refund"
            : "direct_integration_payout",
          status: "completed",
          transactionHash,
          receipts: [
            {
              hash: transactionHash,
              verified: true,
              receiptStatus: "success",
              blockNumber: "999",
              gasUsed: "51110",
            },
          ],
        });
      }
    }
    return Response.json(
      { error: `Unexpected test request: ${request.method} ${request.url}` },
      { status: 500 },
    );
  }) as typeof globalThis.fetch;

  const config: ServiceConfig = {
    port: 8788,
    databasePath: join(directory, "settlement.db"),
    baseSepoliaRpcUrl: "https://base-sepolia-rpc.test",
    baseSepoliaUsdcAddress: USDC,
    facilitatorUrl: "https://facilitator.test",
    keeperHubApiBaseUrl: "https://keeperhub.test",
    keeperHubApiKey: "kh_integration_test",
    settlementAddress: SETTLEMENT,
    taskPriceAtomic: "10000",
    taskDeadlineMs: 5_000,
  };

  let service: Awaited<ReturnType<typeof createSettlementAgentService>> | undefined;
  try {
    service = await createSettlementAgentService(config);
    const submit = async (operationId: string, transactionHash: string) => {
      const body = JSON.stringify({
        skillId: "audit_receipts",
        message: {
          role: "user",
          content: {
            text: JSON.stringify({
              operationId,
              workerAddress: WORKER,
              transactionHashes: [transactionHash],
            }),
          },
        },
      });
      const request = (signature?: string) =>
        new Request("http://localhost/api/agent/tasks", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Task-Access-Token": `lucid-integration-access-token:${operationId}`,
            "Idempotency-Key": operationId,
            ...(signature ? { "PAYMENT-SIGNATURE": signature } : {}),
          },
          body,
        });

      const challenge = await service!.app.fetch(request());
      assert.equal(challenge.status, 402);
      const accepted = await service!.app.fetch(
        request(paymentSignature(challenge, operationId)),
      );
      assert.equal(accepted.status, 200);
      assert.equal(accepted.headers.get("X-Settlement-Operation"), operationId);
      return waitForTerminal(service!.app, operationId);
    };

    const payout = await submit(OPERATION_ID, AUDITED_TX);
    assert.equal(payout.state, "paid");
    assert.equal(payout.direction, "payout");
    assert.equal(
      (payout.execution as Record<string, unknown>).transactionHash,
      PAYOUT_TX,
    );

    const refund = await submit(REFUND_OPERATION_ID, MISSING_TX);
    assert.equal(refund.state, "refunded");
    assert.equal(refund.direction, "refund");
    assert.equal(
      (refund.verification as Record<string, unknown>).reasonCode,
      "RECEIPTS_NOT_CONFIRMED",
    );
    assert.equal(
      (refund.execution as Record<string, unknown>).transactionHash,
      REFUND_TX,
    );
    assert.deepEqual(keeperHubWrites, [
      {
        chainId: "84532",
        recipientAddress: WORKER,
        tokenAddress: USDC,
        amount: "0.01",
      },
      {
        chainId: "84532",
        recipientAddress: PAYER,
        tokenAddress: USDC,
        amount: "0.01",
      },
    ]);
  } finally {
    await service?.close();
    globalThis.fetch = originalFetch;
    rmSync(directory, { recursive: true, force: true });
  }
});
