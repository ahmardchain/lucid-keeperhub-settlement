import {
  assertTransition,
  finalStateForDirection,
  settlementStateForDirection,
} from "./state-machine";
import type {
  ExecutionEvidence,
  SettlementDirection,
  SettlementOperation,
  SettlementStore,
  SimulationEvidence,
  VerificationResult,
} from "./types";
import { SqliteDatabase } from "../storage/sqlite-database";

interface OperationRow {
  operation_id: string;
  state: SettlementOperation["state"];
  operation_json: string;
}

const RECOVERABLE_STATES: SettlementOperation["state"][] = [
  "reserved",
  "running",
  "verifying",
  "settling_payout",
  "settling_refund",
];

function decode(row: OperationRow): SettlementOperation {
  return JSON.parse(row.operation_json) as SettlementOperation;
}

export class SqliteSettlementStore implements SettlementStore {
  private readonly database: SqliteDatabase;

  constructor(databasePath: string) {
    this.database = new SqliteDatabase(databasePath);
    this.database.connection.exec(`
      CREATE TABLE IF NOT EXISTS settlement_operations (
        operation_id TEXT PRIMARY KEY,
        state TEXT NOT NULL,
        lucid_task_id TEXT NOT NULL,
        keeperhub_execution_id TEXT,
        payment_transaction_hash TEXT NOT NULL,
        settlement_transaction_hash TEXT,
        operation_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_settlement_lucid_task
        ON settlement_operations(lucid_task_id);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_settlement_payment_tx
        ON settlement_operations(payment_transaction_hash);
      CREATE INDEX IF NOT EXISTS idx_settlement_state
        ON settlement_operations(state, updated_at DESC);
    `);
  }

  async get(operationId: string): Promise<SettlementOperation | null> {
    const row = this.database.connection
      .prepare("SELECT * FROM settlement_operations WHERE operation_id = ?")
      .get(operationId) as unknown as OperationRow | undefined;
    return row ? decode(row) : null;
  }

  async listRecoverable(): Promise<SettlementOperation[]> {
    const placeholders = RECOVERABLE_STATES.map(() => "?").join(", ");
    const rows = this.database.connection
      .prepare(
        `SELECT * FROM settlement_operations
         WHERE state IN (${placeholders}) ORDER BY created_at ASC`,
      )
      .all(...RECOVERABLE_STATES) as unknown as OperationRow[];
    return rows.map(decode);
  }

  async listAll(): Promise<SettlementOperation[]> {
    return (
      this.database.connection
        .prepare(
          "SELECT * FROM settlement_operations ORDER BY created_at DESC",
        )
        .all() as unknown as OperationRow[]
    ).map(decode);
  }

  async create(operation: SettlementOperation): Promise<SettlementOperation> {
    this.database.connection
      .prepare(
        `INSERT INTO settlement_operations (
          operation_id, state, lucid_task_id, keeperhub_execution_id,
          payment_transaction_hash, settlement_transaction_hash,
          operation_json, created_at, updated_at
        ) VALUES (?, ?, ?, NULL, ?, NULL, ?, ?, ?)`,
      )
      .run(
        operation.operationId,
        operation.state,
        operation.lucidTaskId,
        operation.payment.paymentTransactionHash,
        JSON.stringify(operation),
        operation.createdAt,
        operation.updatedAt,
      );
    return structuredClone(operation);
  }

  async claimTerminalDecision(
    operationId: string,
    verification: VerificationResult,
    direction: SettlementDirection,
    idempotencyKey: string,
  ): Promise<{ operation: SettlementOperation; claimed: boolean }> {
    return this.database.transaction(() => {
      const current = this.require(operationId);
      if (current.verification) {
        if (
          current.verification.outcome !== verification.outcome ||
          current.direction !== direction
        ) {
          throw new Error("Terminal settlement decision is immutable");
        }
        return { operation: current, claimed: false };
      }
      const nextState = settlementStateForDirection(direction);
      assertTransition(current.state, nextState);
      const next: SettlementOperation = {
        ...current,
        state: nextState,
        verification,
        direction,
        idempotencyKey,
        updatedAt: verification.verifiedAt,
      };
      this.write(next);
      return { operation: structuredClone(next), claimed: true };
    });
  }

  async recordSimulation(
    operationId: string,
    simulation: SimulationEvidence,
  ): Promise<SettlementOperation> {
    return this.database.transaction(() => {
      const current = this.require(operationId);
      const next: SettlementOperation = {
        ...current,
        simulation,
        state:
          !simulation.success || simulation.wouldRevert
            ? "blocked"
            : current.state,
        updatedAt: simulation.observedAt,
      };
      this.write(next);
      return structuredClone(next);
    });
  }

  async recordExecution(
    operationId: string,
    execution: ExecutionEvidence,
  ): Promise<SettlementOperation> {
    return this.database.transaction(() => {
      const current = this.require(operationId);
      if (!current.direction) throw new Error("Settlement direction is missing");
      let state = current.state;
      if (execution.status === "completed") {
        state = finalStateForDirection(current.direction);
        assertTransition(current.state, state);
      } else if (execution.status === "failed") {
        state = "settlement_failed";
        assertTransition(current.state, state);
      }
      const next: SettlementOperation = {
        ...current,
        state,
        execution,
        updatedAt: execution.observedAt,
      };
      this.write(next);
      return structuredClone(next);
    });
  }

  close(): void {
    this.database.close();
  }

  private require(operationId: string): SettlementOperation {
    const row = this.database.connection
      .prepare("SELECT * FROM settlement_operations WHERE operation_id = ?")
      .get(operationId) as unknown as OperationRow | undefined;
    if (!row) throw new Error(`Unknown operation: ${operationId}`);
    return decode(row);
  }

  private write(operation: SettlementOperation): void {
    this.database.connection
      .prepare(
        `UPDATE settlement_operations
         SET state = ?, keeperhub_execution_id = ?, settlement_transaction_hash = ?,
             operation_json = ?, updated_at = ?
         WHERE operation_id = ?`,
      )
      .run(
        operation.state,
        operation.execution?.keeperhubExecutionId ?? null,
        operation.execution?.transactionHash ?? null,
        JSON.stringify(operation),
        operation.updatedAt,
        operation.operationId,
      );
  }
}
