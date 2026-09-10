import { PaymentJournal } from "../src/lucid/payment-journal";
const journal = new PaymentJournal(process.env.DATABASE_PATH || ".data/settlement.db");
try {
  console.log(JSON.stringify({ pending: journal.pending().map(i => ({
    operationId: i.operationId, taskId: i.taskId ?? null,
    paymentTransactionHash: i.payment?.paymentTransactionHash ?? null,
    nextAction: i.payment && i.taskId ? "Restart the agent to recover capture" : "Unknown payment outcome: inspect facilitator/onchain evidence; do not repay automatically",
  })) }, null, 2));
} finally { journal.close(); }
