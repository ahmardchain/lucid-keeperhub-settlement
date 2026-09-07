import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { StoredTask } from "@lucid-agents/types/a2a";
import { SqliteTaskStore } from "../../src/lucid/sqlite-task-store";
import { SqliteSettlementStore } from "../../src/settlement/sqlite-store";
import type { SettlementOperation } from "../../src/settlement/types";

test("task records and fenced leases survive reopening SQLite", async () => {
  const directory = mkdtempSync(join(tmpdir(), "lucid-task-store-"));
  const databasePath = join(directory, "settlement.db");
  try {
    const record: StoredTask = {
      ownerHash: "owner-hash",
      task: {
        taskId: "lucid-task-1",
        status: "running",
        createdAt: "2026-09-07T12:00:00.000Z",
        updatedAt: "2026-09-07T12:00:00.000Z",
      },
      admissionExpiresAt: Date.parse("2026-09-07T12:05:00.000Z"),
    };
    let store = new SqliteTaskStore({ databasePath });
    await store.create(record, {
      type: "statusUpdate",
      data: { taskId: record.task.taskId, status: "running" },
    });
    const claimed = await store.claimExecution(
      record.task.taskId,
      "worker-1",
      Date.parse("2026-09-07T12:10:00.000Z"),
      Date.parse("2026-09-07T12:01:00.000Z"),
    );
    assert.equal(claimed?.status, "running");
    store.close();

    store = new SqliteTaskStore({ databasePath });
    const reopened = await store.getDirect(record.task.taskId);
    assert.equal(reopened?.executionLease?.ownerId, "worker-1");
    assert.equal(reopened?.executionLease?.phase, "prepared");
    const stale = await store.activateExecution(
      record.task.taskId,
      "worker-2",
      Date.parse("2026-09-07T12:15:00.000Z"),
      Date.parse("2026-09-07T12:02:00.000Z"),
    );
    assert.equal(stale, undefined);
    store.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("settlement terminal decision and evidence survive reopening SQLite", async () => {
  const directory = mkdtempSync(join(tmpdir(), "settlement-store-"));
  const databasePath = join(directory, "settlement.db");
  try {
    const operation: SettlementOperation = {
      operationId: "task-2026-09-07-0001",
      lucidTaskId: "lucid-task-1",
      lucidRunId: "lucid-task-1",
      entrypoint: "audit_receipts",
      deadlineAt: "2026-09-07T12:05:00.000Z",
      state: "verifying",
      payment: {
        network: "eip155:84532",
        assetAddress: `0x${"11".repeat(20)}`,
        amountAtomic: "10000",
        payerAddress: `0x${"22".repeat(20)}`,
        settlementAddress: `0x${"33".repeat(20)}`,
        paymentTransactionHash: `0x${"44".repeat(32)}`,
        facilitatorReference: "x402:test",
      },
      workerAddress: `0x${"55".repeat(20)}`,
      createdAt: "2026-09-07T12:00:00.000Z",
      updatedAt: "2026-09-07T12:00:00.000Z",
    };
    let store = new SqliteSettlementStore(databasePath);
    await store.create(operation);
    await store.claimTerminalDecision(
      operation.operationId,
      {
        outcome: "failed",
        reasonCode: "TASK_FAILED",
        explanation: "failed",
        verifierVersion: "receipt-audit/v1",
        verifiedAt: "2026-09-07T12:01:00.000Z",
      },
      "refund",
      "lucid-settlement:v1:task-2026-09-07-0001:refund",
    );
    store.close();

    store = new SqliteSettlementStore(databasePath);
    const reopened = await store.get(operation.operationId);
    assert.equal(reopened?.direction, "refund");
    assert.equal(reopened?.verification?.reasonCode, "TASK_FAILED");
    assert.equal((await store.listRecoverable()).length, 1);
    store.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
