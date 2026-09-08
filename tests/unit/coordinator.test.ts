import assert from "node:assert/strict";
import test from "node:test";
import { SettlementCoordinator } from "../../src/settlement/coordinator";
import { FakeKeeperHubExecutor } from "../../src/settlement/fake-executor";
import { MemorySettlementStore } from "../../src/settlement/memory-store";
import type {
  LucidTaskEvidence,
  PaymentEvidence,
} from "../../src/settlement/types";

const SETTLEMENT = `0x${"11".repeat(20)}` as `0x${string}`;
const WORKER = `0x${"22".repeat(20)}` as `0x${string}`;
const PAYER = `0x${"33".repeat(20)}` as `0x${string}`;
const USDC = `0x${"44".repeat(20)}` as `0x${string}`;
const PAYMENT_TX = `0x${"55".repeat(32)}` as `0x${string}`;
const AUDITED_TX = `0x${"66".repeat(32)}`;
const NOW = new Date("2026-09-07T12:00:00.000Z");

function payment(): PaymentEvidence {
  return {
    network: "eip155:84532",
    assetAddress: USDC,
    amountAtomic: "10000",
    payerAddress: PAYER,
    settlementAddress: SETTLEMENT,
    paymentTransactionHash: PAYMENT_TX,
    facilitatorReference: "x402:test",
  };
}

function task(
  overrides: Partial<LucidTaskEvidence> = {},
): LucidTaskEvidence {
  return {
    operationId: "task-2026-09-07-0001",
    lucidTaskId: "lucid-task-1",
    lucidRunId: "lucid-task-1",
    entrypoint: "audit_receipts",
    status: "completed",
    reservedAt: "2026-09-07T11:59:00.000Z",
    deadlineAt: "2026-09-07T12:01:00.000Z",
    completedAt: "2026-09-07T12:00:00.000Z",
    output: {
      requested: 1,
      confirmed: 1,
      failed: 0,
      missing: 0,
      transactionHashes: [AUDITED_TX],
      receipts: [
        {
          transactionHash: AUDITED_TX,
          verdict: "confirmed",
          blockNumber: "0x123",
          gasUsed: "0x5208",
        },
      ],
    },
    ...overrides,
  };
}

async function fixture(
  executor = new FakeKeeperHubExecutor({ simulatedFromAddress: SETTLEMENT }),
) {
  const store = new MemorySettlementStore();
  const coordinator = new SettlementCoordinator({
    store,
    executor,
    settlementAddress: SETTLEMENT,
    usdcAddress: USDC,
    now: () => NOW,
    sleep: async () => undefined,
  });
  const evidence = task();
  await coordinator.reserve({
    task: evidence,
    payment: payment(),
    workerAddress: WORKER,
  });
  return { coordinator, store, executor, evidence };
}

test("valid completed task pays the worker exactly once", async () => {
  const { coordinator, executor, evidence } = await fixture();
  const settled = await coordinator.settle(evidence);
  assert.equal(settled.state, "paid");
  assert.equal(settled.direction, "payout");
  assert.equal(executor.simulationRequests.length, 1);
  assert.equal(executor.executionRequests.length, 1);
  assert.equal(executor.executionRequests[0]?.recipientAddress, WORKER);
  assert.equal(
    executor.executionRequests[0]?.idempotencyKey,
    "lucid-settlement:v1:task-2026-09-07-0001:payout",
  );

  const replay = await coordinator.settle(evidence);
  assert.equal(replay.state, "paid");
  assert.equal(executor.executionRequests.length, 1);
});

for (const status of ["failed", "cancelled"] as const) {
  test(`${status} tasks refund the verified payer`, async () => {
    const { coordinator, executor, evidence } = await fixture();
    const result = await coordinator.settle({ ...evidence, status, output: undefined });
    assert.equal(result.state, "refunded");
    assert.equal(executor.executionRequests[0]?.recipientAddress, PAYER);
  });
}

test("reverting simulation never broadcasts", async () => {
  const executor = new FakeKeeperHubExecutor({ simulation: "revert", simulatedFromAddress: SETTLEMENT });
  const { coordinator, evidence } = await fixture(executor);
  const result = await coordinator.settle(evidence);
  assert.equal(result.state, "blocked");
  assert.equal(executor.executionRequests.length, 0);
});

test("a valid audit with a missing receipt refunds the verified payer", async () => {
  const { coordinator, executor, evidence } = await fixture();
  evidence.output = {
    requested: 1,
    confirmed: 0,
    failed: 0,
    missing: 1,
    transactionHashes: [AUDITED_TX],
    receipts: [{ transactionHash: AUDITED_TX, verdict: "missing" }],
  };
  const settled = await coordinator.settle(evidence);
  assert.equal(settled.state, "refunded");
  assert.equal(settled.verification?.reasonCode, "RECEIPTS_NOT_CONFIRMED");
  assert.equal(executor.executionRequests[0]?.recipientAddress, PAYER);
});

test("a running task cannot settle before its deadline", async () => {
  const { coordinator, executor, evidence } = await fixture();
  evidence.status = "running";
  evidence.output = undefined;
  await assert.rejects(
    coordinator.settle(evidence),
    /not terminal and its deadline has not elapsed/,
  );
  assert.equal(executor.executionRequests.length, 0);
});

test("a task still running after its deadline refunds", async () => {
  const { coordinator, executor, evidence } = await fixture();
  evidence.status = "running";
  evidence.deadlineAt = "2026-09-07T11:59:59.000Z";
  evidence.output = undefined;
  const settled = await coordinator.settle(evidence);
  assert.equal(settled.state, "refunded");
  assert.equal(settled.verification?.reasonCode, "DEADLINE_EXCEEDED");
  assert.equal(executor.executionRequests[0]?.recipientAddress, PAYER);
});

test("a task completed after its deadline refunds even when checked later", async () => {
  const { coordinator, executor, evidence } = await fixture();
  evidence.deadlineAt = "2026-09-07T11:59:59.000Z";
  evidence.completedAt = "2026-09-07T12:00:00.000Z";
  const settled = await coordinator.settle(evidence);
  assert.equal(settled.state, "refunded");
  assert.equal(settled.verification?.reasonCode, "DEADLINE_EXCEEDED");
  assert.equal(executor.executionRequests[0]?.recipientAddress, PAYER);
});

test("inconsistent receipt counts fail schema verification and refund", async () => {
  const { coordinator, executor, evidence } = await fixture();
  evidence.output = {
    ...(evidence.output as Record<string, unknown>),
    confirmed: 1,
    missing: 0,
    receipts: [{ transactionHash: AUDITED_TX, verdict: "missing" }],
  };
  const settled = await coordinator.settle(evidence);
  assert.equal(settled.state, "refunded");
  assert.equal(settled.verification?.reasonCode, "OUTPUT_SCHEMA_INVALID");
  assert.equal(executor.executionRequests[0]?.recipientAddress, PAYER);
});

test("reservation rejects a payTo address outside KeeperHub", async () => {
  const store = new MemorySettlementStore();
  const coordinator = new SettlementCoordinator({
    store,
    executor: new FakeKeeperHubExecutor(),
    settlementAddress: SETTLEMENT,
    usdcAddress: USDC,
  });
  await assert.rejects(
    coordinator.reserve({
      task: task(),
      payment: { ...payment(), settlementAddress: WORKER },
      workerAddress: WORKER,
    }),
    /does not match the KeeperHub settlement wallet/,
  );
});

test("blocks when KeeperHub does not simulate from Lucid's payTo wallet", async () => {
  const executor = new FakeKeeperHubExecutor({
    simulatedFromAddress: WORKER,
  });
  const { coordinator, evidence } = await fixture(executor);
  const settled = await coordinator.settle(evidence);

  assert.equal(settled.state, "blocked");
  assert.equal(settled.simulation?.reason, "KEEPERHUB_SENDER_MISMATCH");
  assert.equal(executor.executionRequests.length, 0);
});

test("does not rebroadcast an uncertain write after KeeperHub's replay window", async () => {
  const store = new MemorySettlementStore();
  const firstExecutor = new FakeKeeperHubExecutor({
    simulatedFromAddress: SETTLEMENT,
  });
  firstExecutor.execute = async () => {
    throw new Error("connection lost after possible broadcast");
  };
  const first = new SettlementCoordinator({
    store,
    executor: firstExecutor,
    settlementAddress: SETTLEMENT,
    usdcAddress: USDC,
    now: () => NOW,
  });
  const evidence = task();
  await first.reserve({ task: evidence, payment: payment(), workerAddress: WORKER });
  await assert.rejects(first.settle(evidence), /connection lost/);

  const recoveryExecutor = new FakeKeeperHubExecutor({
    simulatedFromAddress: SETTLEMENT,
  });
  const recovery = new SettlementCoordinator({
    store,
    executor: recoveryExecutor,
    settlementAddress: SETTLEMENT,
    usdcAddress: USDC,
    now: () => new Date(NOW.getTime() + 24 * 60 * 60 * 1_000),
  });
  const settled = await recovery.settle(evidence);

  assert.equal(settled.state, "blocked");
  assert.equal(
    settled.simulation?.reason,
    "IDEMPOTENCY_REPLAY_WINDOW_EXPIRED",
  );
  assert.equal(recoveryExecutor.executionRequests.length, 0);
});
