import { createHash } from "node:crypto";
import type { LucidTaskEvidence, VerificationResult } from "./types";

export const VERIFIER_VERSION = "receipt-audit/v1";

interface ReceiptAuditOutput {
  requested: number;
  confirmed: number;
  failed: number;
  missing: number;
  transactionHashes: string[];
  receipts: Array<{
    transactionHash: string;
    verdict: "confirmed" | "failed" | "missing";
    blockNumber?: string;
    gasUsed?: string;
  }>;
}

function isReceiptAuditOutput(value: unknown): value is ReceiptAuditOutput {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  if (
    !Number.isInteger(candidate.requested) ||
    !Number.isInteger(candidate.confirmed) ||
    !Number.isInteger(candidate.failed) ||
    !Number.isInteger(candidate.missing) ||
    !Array.isArray(candidate.transactionHashes) ||
    !Array.isArray(candidate.receipts)
  ) {
    return false;
  }

  const requested = candidate.requested as number;
  const confirmed = candidate.confirmed as number;
  const failed = candidate.failed as number;
  const missing = candidate.missing as number;

  const hashes = candidate.transactionHashes as unknown[];
  const receipts = candidate.receipts as unknown[];
  const normalizedHashes = hashes.map((hash) =>
    typeof hash === "string" ? hash.toLowerCase() : "",
  );
  const receiptVerdicts = receipts.map((receipt) => {
    if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)) {
      return null;
    }
    const value = receipt as Record<string, unknown>;
    if (
      typeof value.transactionHash !== "string" ||
      !/^0x[a-fA-F0-9]{64}$/.test(value.transactionHash) ||
      !["confirmed", "failed", "missing"].includes(String(value.verdict)) ||
      (value.blockNumber !== undefined && typeof value.blockNumber !== "string") ||
      (value.gasUsed !== undefined && typeof value.gasUsed !== "string")
    ) {
      return null;
    }
    return {
      transactionHash: value.transactionHash.toLowerCase(),
      verdict: value.verdict as "confirmed" | "failed" | "missing",
    };
  });

  return (
    requested > 0 &&
    requested <= 20 &&
    confirmed >= 0 &&
    failed >= 0 &&
    missing >= 0 &&
    confirmed + failed + missing === requested &&
    hashes.length === requested &&
    receipts.length === requested &&
    hashes.every(
      (hash) => typeof hash === "string" && /^0x[a-fA-F0-9]{64}$/.test(hash),
    ) &&
    new Set(normalizedHashes).size === requested &&
    receiptVerdicts.every(
      (receipt, index) =>
        receipt !== null && receipt.transactionHash === normalizedHashes[index],
    ) &&
    receiptVerdicts.filter((receipt) => receipt?.verdict === "confirmed").length ===
      confirmed &&
    receiptVerdicts.filter((receipt) => receipt?.verdict === "failed").length ===
      failed &&
    receiptVerdicts.filter((receipt) => receipt?.verdict === "missing").length ===
      missing
  );
}

function digestOutput(output: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(output))
    .digest("hex");
}

export function verifyLucidTask(
  task: LucidTaskEvidence,
  now = new Date(),
): VerificationResult {
  const verifiedAt = now.toISOString();
  const deadlineAt = Date.parse(task.deadlineAt);

  if (task.status === "cancelled") {
    return {
      outcome: "cancelled",
      reasonCode: "TASK_CANCELLED",
      explanation: "Lucid reported the task as cancelled.",
      verifierVersion: VERIFIER_VERSION,
      verifiedAt,
    };
  }

  if (task.status === "failed") {
    return {
      outcome: "failed",
      reasonCode: "TASK_FAILED",
      explanation: task.failureCode
        ? `Lucid task failed with ${task.failureCode}.`
        : "Lucid reported the task as failed.",
      verifierVersion: VERIFIER_VERSION,
      verifiedAt,
    };
  }

  if (task.status === "running") {
    if (Number.isFinite(deadlineAt) && now.getTime() <= deadlineAt) {
      throw new Error("Lucid task is not terminal and its deadline has not elapsed");
    }
    return {
      outcome: "expired",
      reasonCode: "DEADLINE_EXCEEDED",
      explanation: "The task did not produce a valid result before its deadline.",
      verifierVersion: VERIFIER_VERSION,
      verifiedAt,
    };
  }

  const completedAt = task.completedAt ? Date.parse(task.completedAt) : Number.NaN;
  if (
    task.status === "completed" &&
    (!Number.isFinite(deadlineAt) ||
      !Number.isFinite(completedAt) ||
      completedAt > deadlineAt)
  ) {
    return {
      outcome: "expired",
      reasonCode: "DEADLINE_EXCEEDED",
      explanation: "The task did not prove completion before its deadline.",
      verifierVersion: VERIFIER_VERSION,
      verifiedAt,
    };
  }

  if (task.status !== "completed" || !isReceiptAuditOutput(task.output)) {
    return {
      outcome: "invalid_output",
      reasonCode: "OUTPUT_SCHEMA_INVALID",
      explanation: "The task output failed the deterministic receipt-audit schema.",
      verifierVersion: VERIFIER_VERSION,
      verifiedAt,
    };
  }

  if (
    task.output.confirmed !== task.output.requested ||
    task.output.failed !== 0 ||
    task.output.missing !== 0
  ) {
    return {
      outcome: "failed",
      reasonCode: "RECEIPTS_NOT_CONFIRMED",
      explanation:
        "One or more requested transactions were missing or did not succeed onchain.",
      verifierVersion: VERIFIER_VERSION,
      verifiedAt,
      outputDigest: digestOutput(task.output),
    };
  }

  return {
    outcome: "success",
    reasonCode: "OUTPUT_VALID",
    explanation: "The task completed before deadline with a valid receipt audit.",
    verifierVersion: VERIFIER_VERSION,
    verifiedAt,
    outputDigest: digestOutput(task.output),
  };
}
