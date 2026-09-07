import { createHash } from "node:crypto";
import { extractPayerAddress } from "@lucid-agents/payments";
import {
  normalizeAddress,
  normalizeTransactionHash,
} from "../settlement/identity";
import type { PaymentEvidence } from "../settlement/types";

interface ParsePaymentEvidenceOptions {
  paymentResponseHeader: string;
  expectedNetwork: PaymentEvidence["network"];
  expectedAssetAddress: `0x${string}`;
  expectedAmountAtomic: string;
  settlementAddress: `0x${string}`;
}

function decodeHeader(header: string): Record<string, unknown> {
  try {
    const normalized = header.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(
      normalized.length + ((4 - (normalized.length % 4)) % 4),
      "=",
    );
    const value = JSON.parse(
      Buffer.from(padded, "base64").toString("utf8"),
    ) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("decoded value is not an object");
    }
    return value as Record<string, unknown>;
  } catch (error) {
    throw new Error("Invalid x402 PAYMENT-RESPONSE header", { cause: error });
  }
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function parsePaymentEvidence(
  options: ParsePaymentEvidenceOptions,
): PaymentEvidence {
  const decoded = decodeHeader(options.paymentResponseHeader);
  if (decoded.success !== true) {
    throw new Error("x402 response does not prove successful settlement");
  }

  const payer = extractPayerAddress(options.paymentResponseHeader);
  if (!payer) throw new Error("x402 response omitted the verified payer");

  const transaction =
    optionalString(decoded.transaction) ??
    optionalString(decoded.transactionHash) ??
    optionalString(decoded.txHash);
  if (!transaction) {
    throw new Error("x402 response omitted its settlement transaction hash");
  }

  const network = optionalString(decoded.network);
  if (network && network !== options.expectedNetwork) {
    throw new Error("x402 response network does not match the paid offer");
  }
  const amount = optionalString(decoded.amount);
  if (amount && amount !== options.expectedAmountAtomic) {
    throw new Error("x402 response amount does not match the paid offer");
  }

  return {
    network: options.expectedNetwork,
    assetAddress: normalizeAddress(options.expectedAssetAddress),
    amountAtomic: options.expectedAmountAtomic,
    payerAddress: normalizeAddress(payer),
    settlementAddress: normalizeAddress(options.settlementAddress),
    paymentTransactionHash: normalizeTransactionHash(transaction),
    facilitatorReference: `x402:${createHash("sha256")
      .update(options.paymentResponseHeader)
      .digest("hex")}`,
  };
}
