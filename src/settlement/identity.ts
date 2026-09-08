const ADDRESS_PATTERN = /^0x[a-fA-F0-9]{40}$/;
const TX_HASH_PATTERN = /^0x[a-fA-F0-9]{64}$/;

export function normalizeAddress(value: string): `0x${string}` {
  if (!ADDRESS_PATTERN.test(value)) {
    throw new Error("Expected a 20-byte EVM address");
  }
  if (/^0x0{40}$/i.test(value)) throw new Error("Zero address is not a valid settlement participant");
  return value.toLowerCase() as `0x${string}`;
}

export function normalizeTransactionHash(value: string): `0x${string}` {
  if (!TX_HASH_PATTERN.test(value)) {
    throw new Error("Expected a 32-byte EVM transaction hash");
  }
  return value.toLowerCase() as `0x${string}`;
}

export function assertPositiveAtomicAmount(value: string): void {
  if (!/^\d+$/.test(value) || BigInt(value) <= 0n) {
    throw new Error("Settlement amount must be a positive atomic-unit integer");
  }
}

export function assertPayerOwnsRefundDestination(
  payerAddress: string,
  recipientAddress: string,
): void {
  if (normalizeAddress(payerAddress) !== normalizeAddress(recipientAddress)) {
    throw new Error("Refund recipient must match the verified x402 payer");
  }
}
