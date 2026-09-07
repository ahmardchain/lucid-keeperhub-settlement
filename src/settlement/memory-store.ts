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

function clone(operation: SettlementOperation): SettlementOperation {
  return structuredClone(operation);
}

export class MemorySettlementStore implements SettlementStore {
  private readonly operations = new Map<string, SettlementOperation>();

  async get(operationId: string): Promise<SettlementOperation | null> {
    const operation = this.operations.get(operationId);
    return operation ? clone(operation) : null;
  }

  async listRecoverable(): Promise<SettlementOperation[]> {
    return [...this.operations.values()]
      .filter((operation) => !["paid", "refunded", "blocked", "settlement_failed"].includes(operation.state))
      .map(clone);
  }

  async create(operation: SettlementOperation): Promise<SettlementOperation> {
    if (this.operations.has(operation.operationId)) {
      throw new Error(`Operation already exists: ${operation.operationId}`);
    }
    this.operations.set(operation.operationId, clone(operation));
    return clone(operation);
  }

  async claimTerminalDecision(
    operationId: string,
    verification: VerificationResult,
    direction: SettlementDirection,
    idempotencyKey: string,
  ): Promise<{ operation: SettlementOperation; claimed: boolean }> {
    const current = this.require(operationId);

    if (current.verification) {
      if (
        current.verification.outcome !== verification.outcome ||
        current.direction !== direction
      ) {
        throw new Error("Terminal settlement decision is immutable");
      }
      return { operation: clone(current), claimed: false };
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
    this.operations.set(operationId, next);
    return { operation: clone(next), claimed: true };
  }

  async recordSimulation(
    operationId: string,
    simulation: SimulationEvidence,
  ): Promise<SettlementOperation> {
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
    this.operations.set(operationId, next);
    return clone(next);
  }

  async recordExecution(
    operationId: string,
    execution: ExecutionEvidence,
  ): Promise<SettlementOperation> {
    const current = this.require(operationId);
    if (!current.direction) throw new Error("Settlement direction is missing");

    let nextState = current.state;
    if (execution.status === "completed") {
      const expected = finalStateForDirection(current.direction);
      assertTransition(current.state, expected);
      nextState = expected;
    } else if (execution.status === "failed") {
      assertTransition(current.state, "settlement_failed");
      nextState = "settlement_failed";
    }

    const next: SettlementOperation = {
      ...current,
      state: nextState,
      execution,
      updatedAt: execution.observedAt,
    };
    this.operations.set(operationId, next);
    return clone(next);
  }

  private require(operationId: string): SettlementOperation {
    const operation = this.operations.get(operationId);
    if (!operation) throw new Error(`Unknown operation: ${operationId}`);
    return operation;
  }
}
