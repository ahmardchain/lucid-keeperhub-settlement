import type {
  OperationState,
  SettlementDirection,
  TerminalOutcome,
} from "./types";

const transitions: Record<OperationState, readonly OperationState[]> = {
  reserved: ["running", "verifying"],
  running: ["verifying"],
  verifying: ["settling_payout", "settling_refund", "blocked"],
  settling_payout: ["paid", "settlement_failed"],
  settling_refund: ["refunded", "settlement_failed"],
  paid: [],
  refunded: [],
  blocked: [],
  settlement_failed: [],
};

export const finalStates: readonly OperationState[] = [
  "paid",
  "refunded",
  "blocked",
  "settlement_failed",
];

export function directionForOutcome(
  outcome: TerminalOutcome,
): SettlementDirection {
  return outcome === "success" ? "payout" : "refund";
}

export function settlementStateForDirection(
  direction: SettlementDirection,
): OperationState {
  return direction === "payout" ? "settling_payout" : "settling_refund";
}

export function finalStateForDirection(
  direction: SettlementDirection,
): OperationState {
  return direction === "payout" ? "paid" : "refunded";
}

export function canTransition(
  from: OperationState,
  to: OperationState,
): boolean {
  return transitions[from].includes(to);
}

export function assertTransition(
  from: OperationState,
  to: OperationState,
): void {
  if (!canTransition(from, to)) {
    throw new Error(`Invalid settlement transition: ${from} -> ${to}`);
  }
}

export function isFinalState(state: OperationState): boolean {
  return finalStates.includes(state);
}
