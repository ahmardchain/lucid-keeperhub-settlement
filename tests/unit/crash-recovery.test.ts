import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { SettlementCoordinator } from "../../src/settlement/coordinator";
import { SqliteSettlementStore } from "../../src/settlement/sqlite-store";

test("killed process recovers a persisted execution by polling, with no new broadcast", { timeout: 15000 }, async () => {
  const directory = mkdtempSync(join(tmpdir(), "settlement-crash-"));
  const database = join(directory, "settlement.db");
  const child = spawn(process.execPath, ["--import", "tsx", "tests/fixtures/crash-writer.ts", database], { stdio: ["ignore", "pipe", "pipe"] });
  let store: SqliteSettlementStore | undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      let output = "";
      const timer = setTimeout(() => reject(new Error("Child did not save execution")), 10000);
      child.on("error", error => { clearTimeout(timer); reject(error); });
      child.on("exit", code => { clearTimeout(timer); reject(new Error(`Child exited early: ${code}`)); });
      child.stdout.on("data", chunk => {
        output += chunk.toString();
        if (output.includes("SAVED_EXECUTION")) { clearTimeout(timer); resolve(); }
      });
    });
    const exited = once(child, "exit");
    child.kill("SIGKILL");
    await exited;
    store = new SqliteSettlementStore(database);
    const operation = await store.get("crash-test");
    assert.ok(operation);
    let polls = 0;
    const coordinator = new SettlementCoordinator({ store,
      settlementAddress: operation.payment.settlementAddress, usdcAddress: operation.payment.assetAddress,
      executor: {
        simulate: async () => { throw new Error("Recovery must not simulate again"); },
        execute: async () => { throw new Error("Recovery must not broadcast again"); },
        getExecution: async id => {
          assert.equal(id, "saved-execution"); polls++;
          return { keeperhubExecutionId: id, status: "completed", transactionHash: `0x${"66".repeat(32)}`,
            receiptVerified: true, receiptStatus: "success", observedAt: new Date().toISOString() };
        },
      },
    });
    const task = { operationId: operation.operationId, lucidTaskId: operation.lucidTaskId,
      lucidRunId: operation.lucidRunId, entrypoint: operation.entrypoint, status: "failed" as const,
      reservedAt: operation.createdAt, deadlineAt: operation.deadlineAt };
    assert.equal((await coordinator.settle(task)).state, "refunded");
    assert.equal((await coordinator.settle(task)).state, "refunded");
    assert.equal(polls, 1);
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, "exit"); child.kill("SIGKILL"); await exited;
    }
    store?.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
