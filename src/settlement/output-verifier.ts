import { createHash } from "node:crypto";
import type { LucidTaskEvidence, VerificationResult } from "./types";
import { verifyLucidTask } from "./verifier";

/** Application-owned deterministic check; lifecycle/deadline gates stay enforced. */
export function withOutputVerifier(
  version: string,
  accepts: (output: unknown) => boolean,
): (task: LucidTaskEvidence, now: Date) => VerificationResult {
  if (!version.trim()) throw new Error("Verifier version is required");
  return (task, now) => {
    if (task.status !== "completed" || !task.completedAt ||
        !Number.isFinite(Date.parse(task.deadlineAt)) ||
        !Number.isFinite(Date.parse(task.completedAt)) ||
        Date.parse(task.completedAt) > Date.parse(task.deadlineAt)) {
      return verifyLucidTask(task, now);
    }
    let valid = false;
    try { valid = accepts(task.output) === true; } catch { /* fail closed */ }
    return {
      outcome: valid ? "success" : "invalid_output",
      reasonCode: valid ? "OUTPUT_VALID" : "OUTPUT_SCHEMA_INVALID",
      explanation: valid ? "Application verifier accepted the task output." : "Application verifier rejected the task output.",
      verifierVersion: version, verifiedAt: now.toISOString(),
      outputDigest: createHash("sha256").update(JSON.stringify(task.output) ?? "undefined").digest("hex"),
    };
  };
}
