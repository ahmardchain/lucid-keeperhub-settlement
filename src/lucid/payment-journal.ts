import { AsyncLocalStorage } from "node:async_hooks";
import { SqliteDatabase } from "../storage/sqlite-database";
import type { PaymentEvidence } from "../settlement/types";

export interface PaymentIntent {
  operationId: string;
  requestDigest: string;
  ownerDigest: string;
  entrypoint: string;
  workerAddress: `0x${string}`;
  reservedAt: string;
  deadlineAt: string;
  taskId?: string;
  payment?: PaymentEvidence;
  state: "pending" | "captured";
}
export const paymentContext = new AsyncLocalStorage<{ journal: PaymentJournal; operationId: string }>();

/** No access tokens, signing keys or signed authorizations are persisted. */
export class PaymentJournal {
  private readonly db: SqliteDatabase;
  constructor(path: string) {
    this.db = new SqliteDatabase(path);
    this.db.connection.exec(`CREATE TABLE IF NOT EXISTS payment_intents (
      operation_id TEXT PRIMARY KEY, intent_json TEXT NOT NULL)`);
  }
  get(id: string): PaymentIntent | undefined {
    const row = this.db.connection.prepare("SELECT intent_json FROM payment_intents WHERE operation_id = ?").get(id) as {intent_json: string} | undefined;
    return row ? JSON.parse(row.intent_json) : undefined;
  }
  begin(intent: PaymentIntent): void {
    this.db.connection.prepare("INSERT INTO payment_intents VALUES (?, ?)").run(intent.operationId, JSON.stringify(intent));
  }
  update(id: string, patch: Partial<Pick<PaymentIntent, "taskId" | "payment" | "state">>): void {
    this.db.transaction(() => {
      const current = this.get(id);
      if (!current) throw new Error("Payment intent missing");
      if (patch.taskId && current.taskId && patch.taskId !== current.taskId) throw new Error("Payment task identity conflict");
      if (patch.payment && current.payment && patch.payment.paymentTransactionHash !== current.payment.paymentTransactionHash) throw new Error("Payment transaction conflict");
      this.db.connection.prepare("UPDATE payment_intents SET intent_json = ? WHERE operation_id = ?")
        .run(JSON.stringify({...current, ...patch}), id);
    });
  }
  pending(): PaymentIntent[] {
    return (this.db.connection.prepare("SELECT intent_json FROM payment_intents").all() as unknown as {intent_json: string}[])
      .map(r => JSON.parse(r.intent_json) as PaymentIntent).filter(r => r.state === "pending");
  }
  close(): void { this.db.close(); }
}
