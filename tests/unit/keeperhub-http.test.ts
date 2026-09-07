import assert from "node:assert/strict";
import test from "node:test";
import {
  atomicToDecimal,
  KeeperHubHttpExecutor,
} from "../../src/keeperhub/http-executor";
import type { SettlementRequest } from "../../src/settlement/types";

const TX = `0x${"ab".repeat(32)}` as `0x${string}`;
const TOKEN = `0x${"11".repeat(20)}` as `0x${string}`;
const RECIPIENT = `0x${"22".repeat(20)}` as `0x${string}`;

function request(): SettlementRequest {
  return {
    operationId: "task-2026-09-07-0001",
    direction: "refund",
    chainId: 84532,
    tokenAddress: TOKEN,
    recipientAddress: RECIPIENT,
    amountAtomic: "10000",
    idempotencyKey: "lucid-settlement:v1:task-2026-09-07-0001:refund",
    lucidTaskId: "lucid-task-1",
    reasonCode: "TASK_FAILED",
  };
}

test("converts six-decimal atomic USDC without floating point", () => {
  assert.equal(atomicToDecimal("1"), "0.000001");
  assert.equal(atomicToDecimal("10000"), "0.01");
  assert.equal(atomicToDecimal("1200000"), "1.2");
});

test("uses simulate, stable broadcast key, then verified receipt polling", async () => {
  const seen: Request[] = [];
  const responses = [
    Response.json({
      success: true,
      status: "simulated",
      from: `0x${"33".repeat(20)}`,
      to: TOKEN,
      value: "0",
      gasEstimate: "65124",
      wouldRevert: false,
    }),
    Response.json(
      { executionId: "direct_123", status: "completed", transactionHash: TX },
      { status: 202 },
    ),
    Response.json({
      executionId: "direct_123",
      status: "completed",
      transactionHash: TX,
      receipts: [
        {
          hash: TX,
          verified: true,
          receiptStatus: "success",
          blockNumber: "3123",
          gasUsed: "51110",
        },
      ],
    }),
  ];
  const executor = new KeeperHubHttpExecutor({
    apiKey: "kh_test_key",
    baseUrl: "https://keeperhub.test",
    now: () => new Date("2026-09-07T12:00:00.000Z"),
    fetchImpl: async (input, init) => {
      seen.push(new Request(input, init));
      return responses.shift()!;
    },
  });

  const simulation = await executor.simulate(request());
  assert.equal(simulation.success, true);
  const accepted = await executor.execute(request());
  assert.equal(accepted.status, "pending");
  const final = await executor.getExecution("direct_123");
  assert.equal(final.status, "completed");
  assert.equal(final.receiptVerified, true);
  assert.equal(final.transactionHash, TX);

  assert.deepEqual(await seen[0]?.json(), {
    chainId: "84532",
    recipientAddress: RECIPIENT,
    tokenAddress: TOKEN,
    amount: "0.01",
    simulate: true,
  });
  assert.equal(
    seen[1]?.headers.get("Idempotency-Key"),
    request().idempotencyKey,
  );
  assert.deepEqual(await seen[1]?.json(), {
    chainId: "84532",
    recipientAddress: RECIPIENT,
    tokenAddress: TOKEN,
    amount: "0.01",
  });
  assert.match(seen[2]?.url ?? "", /direct_123\/status$/);
});

test("fails closed when completed lacks an independently verified receipt", async () => {
  const executor = new KeeperHubHttpExecutor({
    apiKey: "kh_test_key",
    fetchImpl: async () =>
      Response.json({
        executionId: "direct_bad",
        status: "completed",
        transactionHash: TX,
        receipts: [
          { hash: TX, verified: false, receiptStatus: "not_found" },
        ],
      }),
  });
  const result = await executor.getExecution("direct_bad");
  assert.equal(result.status, "failed");
  assert.equal(result.receiptVerified, false);
  assert.match(result.error ?? "", /lacked a verified successful receipt/);
});

test("treats a failed broadcast acknowledgement as pending until status is read", async () => {
  const executor = new KeeperHubHttpExecutor({
    apiKey: "kh_test_key",
    fetchImpl: async () =>
      Response.json(
        {
          executionId: "direct_failed_ack",
          status: "failed",
          error: "broadcast rejected",
        },
        { status: 202 },
      ),
  });

  const result = await executor.execute(request());
  assert.equal(result.status, "pending");
  assert.equal(result.keeperhubExecutionId, "direct_failed_ack");
  assert.equal(result.error, undefined);
});

test("keeps polling a future non-terminal status using KeeperHub's hint", async () => {
  const executor = new KeeperHubHttpExecutor({
    apiKey: "kh_test_key",
    fetchImpl: async () =>
      Response.json(
        { executionId: "direct_future", status: "confirming" },
        { headers: { "X-Poll-Interval-Hint": "2000" } },
      ),
  });

  const result = await executor.getExecution("direct_future");
  assert.equal(result.status, "pending");
});

test("fails closed when the verified receipt and reported hashes disagree", async () => {
  const otherHash = `0x${"cd".repeat(32)}`;
  const executor = new KeeperHubHttpExecutor({
    apiKey: "kh_test_key",
    fetchImpl: async () =>
      Response.json({
        executionId: "direct_mismatch",
        status: "completed",
        transactionHash: TX,
        receipts: [
          {
            hash: otherHash,
            verified: true,
            receiptStatus: "success",
          },
        ],
      }),
  });

  const result = await executor.getExecution("direct_mismatch");
  assert.equal(result.status, "failed");
  assert.match(result.error ?? "", /did not match/);
});
