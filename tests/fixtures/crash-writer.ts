import { SqliteSettlementStore } from "../../src/settlement/sqlite-store";
const store = new SqliteSettlementStore(process.argv[2]);
const at = new Date().toISOString();
await store.create({
  operationId: "crash-test", lucidTaskId: "crash-task", lucidRunId: "crash-task",
  entrypoint: "audit_receipts", deadlineAt: at, state: "verifying",
  payment: { network: "eip155:84532", assetAddress: `0x${"11".repeat(20)}`,
    payerAddress: `0x${"22".repeat(20)}`, settlementAddress: `0x${"33".repeat(20)}`,
    amountAtomic: "10000", paymentTransactionHash: `0x${"44".repeat(32)}`, facilitatorReference: "test" },
  workerAddress: `0x${"55".repeat(20)}`, createdAt: at, updatedAt: at,
});
await store.claimTerminalDecision("crash-test", {
  outcome: "failed", reasonCode: "TASK_FAILED", explanation: "test", verifierVersion: "receipt-audit/v1", verifiedAt: at,
}, "refund", "lucid-settlement:v1:crash-test:refund");
await store.recordSimulation("crash-test", { success: true, wouldRevert: false, observedAt: at });
await store.recordExecution("crash-test", { keeperhubExecutionId: "saved-execution", status: "pending", observedAt: at });
console.log("SAVED_EXECUTION");
setInterval(() => {}, 1000);
