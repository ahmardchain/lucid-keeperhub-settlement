import type { SettlementDirection } from "./types";

const SAFE_ID_PATTERN = /^[a-zA-Z0-9._:-]{8,180}$/;

export function assertOperationId(operationId: string): void {
  if (!SAFE_ID_PATTERN.test(operationId)) {
    throw new Error(
      "operationId must be 8-180 safe characters and contain no sensitive data",
    );
  }
}

export function settlementIdempotencyKey(
  operationId: string,
  direction: SettlementDirection,
): string {
  assertOperationId(operationId);
  return `lucid-settlement:v1:${operationId}:${direction}`;
}
