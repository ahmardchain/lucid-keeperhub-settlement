import { paymentDiagnostic } from "../src/x402/diagnostics";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  fetchAgentCard,
  getTask,
  sendMessage,
} from "@lucid-agents/a2a";
import {
  accountFromPrivateKey,
  createX402Fetch,
} from "@lucid-agents/payments";
import type { Task, TaskAccess } from "@lucid-agents/types/a2a";
import type { SettlementOperation } from "../src/settlement/types";

const ENTRYPOINT = "audit_receipts";
const TERMINAL_STATES = new Set(["paid", "refunded", "blocked", "settlement_failed"]);

interface PublicReceiptOperation {
  operationId: string;
  lucidTaskId: string;
  state: string;
  direction: "payout" | "refund";
  reasonCode: string;
  payerAddress: string;
  recipientAddress: string;
  amountAtomic: string;
  paymentTransactionHash: string;
  keeperhubExecutionId: string;
  settlementTransactionHash: string;
  receiptVerified: boolean;
  receiptStatus: string;
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function positiveInteger(name: string, fallback: number): number {
  const value = process.env[name]?.trim();
  const parsed = value ? Number(value) : fallback;
  if (!Number.isSafeInteger(parsed) || parsed <= 0 || parsed > 20) {
    throw new Error(`${name} must be an integer from 1 to 20`);
  }
  return parsed;
}

function assertHash(value: string, name: string): `0x${string}` {
  if (!/^0x[a-fA-F0-9]{64}$/.test(value)) {
    throw new Error(`${name} must be a 32-byte transaction hash`);
  }
  return value.toLowerCase() as `0x${string}`;
}

function assertAddress(value: string, name: string): `0x${string}` {
  if (!/^0x[a-fA-F0-9]{40}$/.test(value) || /^0x0{40}$/i.test(value)) {
    throw new Error(`${name} must be a 20-byte EVM address`);
  }
  return value.toLowerCase() as `0x${string}`;
}

async function waitForTask(
  card: Awaited<ReturnType<typeof fetchAgentCard>>,
  access: TaskAccess,
  timeoutMs = 120_000,
): Promise<Task> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const task = await getTask(card, access);
    if (task.status !== "running") return task;
    await new Promise((resolve) => setTimeout(resolve, 750));
  }
  throw new Error(`Lucid task ${access.taskId} did not become terminal`);
}

async function waitForSettlement(
  settlementApiUrl: string,
  operationId: string,
  timeoutMs = 180_000,
): Promise<SettlementOperation> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const response = await fetch(
      `${settlementApiUrl}/${encodeURIComponent(operationId)}`,
    );
    if (response.ok) {
      const operation = (await response.json()) as SettlementOperation;
      if (TERMINAL_STATES.has(operation.state)) return operation;
    }
    await new Promise((resolve) => setTimeout(resolve, 1_500));
  }
  throw new Error(`Settlement ${operationId} did not become terminal`);
}

function publicReceipt(operation: SettlementOperation): PublicReceiptOperation {
  if (
    !operation.direction ||
    !operation.verification ||
    !operation.execution?.keeperhubExecutionId ||
    !operation.execution.transactionHash ||
    operation.execution.status !== "completed" ||
    operation.execution.receiptStatus !== "success"
  ) {
    throw new Error(`Operation ${operation.operationId} lacks terminal evidence`);
  }
  const expectedState = operation.direction === "payout" ? "paid" : "refunded";
  if (operation.state !== expectedState) {
    throw new Error(
      `Operation ${operation.operationId} is ${operation.state}; expected ${expectedState}`,
    );
  }
  if (!operation.execution.receiptVerified) {
    throw new Error(`Operation ${operation.operationId} lacks a verified receipt`);
  }
  const recipientAddress =
    operation.direction === "refund"
      ? operation.payment.payerAddress
      : operation.workerAddress;
  return {
    operationId: operation.operationId,
    lucidTaskId: operation.lucidTaskId,
    state: operation.state,
    direction: operation.direction,
    reasonCode: operation.verification.reasonCode,
    payerAddress: operation.payment.payerAddress,
    recipientAddress,
    amountAtomic: operation.payment.amountAtomic,
    paymentTransactionHash: operation.payment.paymentTransactionHash,
    keeperhubExecutionId: operation.execution.keeperhubExecutionId,
    settlementTransactionHash: operation.execution.transactionHash,
    receiptVerified: operation.execution.receiptVerified,
    receiptStatus: operation.execution.receiptStatus ?? "unknown",
  };
}

async function main(): Promise<void> {
const agentUrl = process.env.AGENT_URL?.trim() || "http://localhost:8788/api/agent";
const settlementApiUrl =
  process.env.SETTLEMENT_API_URL?.trim() ||
  `${new URL(agentUrl).origin}/api/settlements`;
const receipts: PublicReceiptOperation[] = [];
const evidencePath = resolve("artifacts/receipts.json");
try {
  const previous = JSON.parse(await readFile(evidencePath, "utf8"));
  if (previous.mode !== "base_sepolia_live" || previous.network !== "eip155:84532" || !Array.isArray(previous.operations)) {
    throw new Error("Existing evidence bundle has an unexpected format; preserve and review it first");
  }
  receipts.push(...previous.operations);
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
}

const attemptPath = resolve(".data/demo-attempts.json");
type Attempt = { operationId: string; direction: "payout" | "refund"; complete: boolean; accessToken?: string; input?: {operationId: string; workerAddress: string; transactionHashes: string[]} };
let attempts: Attempt[] = [];
try { attempts = JSON.parse(await readFile(attemptPath, "utf8")); }
catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
async function saveAttempts(): Promise<void> {
  await mkdir(dirname(attemptPath), {recursive: true});
  const temporary = `${attemptPath}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(attempts, null, 2), {mode: 0o600});
  await rename(temporary, attemptPath);
}
if (process.argv.includes("--replay")) {
  const attempt = [...attempts].reverse().find(a => a.complete && a.accessToken && a.input);
  if (!attempt) throw new Error("No replay-capable completed attempt exists; record a successful run with this release first");
  const before = await waitForSettlement(settlementApiUrl, attempt.operationId);
  // Plain fetch deliberately cannot sign or pay an x402 challenge.
  const response = await fetch(`${agentUrl}/tasks`, {method: "POST", headers: {
    "Content-Type": "application/json", "Idempotency-Key": attempt.operationId, "Task-Access-Token": attempt.accessToken!,
  }, body: JSON.stringify({skillId: ENTRYPOINT, message: {role: "user", content: {text: JSON.stringify(attempt.input)}}}), signal: AbortSignal.timeout(20_000)});
  if (!response.ok || response.headers.get("X-Settlement-Replayed") !== "true") throw new Error("Server did not acknowledge a captured replay");
  const after = await waitForSettlement(settlementApiUrl, attempt.operationId);
  if (before.execution?.keeperhubExecutionId !== after.execution?.keeperhubExecutionId || before.execution?.transactionHash !== after.execution?.transactionHash) throw new Error("Replay evidence changed");
  console.info(`[replay] ${attempt.operationId}: existing execution ${after.execution?.keeperhubExecutionId}; transaction unchanged. No payment signature was sent.`);
  return;
}
if (process.argv.includes("--resume")) {
  for (const attempt of attempts.filter(a => !a.complete)) {
    const response = await fetch(`${settlementApiUrl}/${encodeURIComponent(attempt.operationId)}`, {signal: AbortSignal.timeout(20_000)});
    if (!response.ok) {
      console.info(`[resume] ${attempt.operationId}: no captured settlement (${response.status}); run npm run reconciliation:status in the server folder. No payment sent.`);
      continue;
    }
    const operation = await waitForSettlement(settlementApiUrl, attempt.operationId);
    if (operation.direction !== attempt.direction) throw new Error("Unexpected settlement direction");
    if (!receipts.some(r => r.operationId === operation.operationId)) receipts.push(publicReceipt(operation));
    await saveEvidence();
    attempt.complete = true;
    await saveAttempts();
    console.info(`[resume] recovered ${operation.direction} ${operation.operationId}`);
  }
  console.info("[resume] Read-only check complete; no payment requests were sent.");
  return;
}
if (attempts.some(a => !a.complete)) {
  console.error("[demo] An interrupted attempt is preserved. Run npm run demo:resume before starting new paid work.");
  process.exitCode = 1;
  return;
}
const workerAddress = assertAddress(
  required("WORKER_PAYOUT_ADDRESS"),
  "WORKER_PAYOUT_ADDRESS",
);
const successTransactionHash = assertHash(
  required("DEMO_SUCCESS_TX_HASH"),
  "DEMO_SUCCESS_TX_HASH",
);
const buyerPrivateKey = required("BUYER_PRIVATE_KEY") as `0x${string}`;
const runsPerPath = positiveInteger("DEMO_RUNS_PER_PATH", 1);

const account = accountFromPrivateKey(buyerPrivateKey);
const paidFetch = createX402Fetch({
  account,
  networks: ["base-sepolia"],
});
const card = await fetchAgentCard(agentUrl);
async function saveEvidence(): Promise<void> {
  const bundle = {
    schemaVersion: "1.0", mode: "base_sepolia_live", network: "eip155:84532",
    generatedAt: new Date().toISOString(), operations: receipts,
  };
  for (const output of [evidencePath, resolve("public/evidence/receipts.json")]) {
    await mkdir(dirname(output), { recursive: true });
    const temporary = `${output}.${randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(bundle, null, 2)}\n`, "utf8");
    await rename(temporary, output);
  }
}

async function runCase(
  expectedDirection: "payout" | "refund",
  transactionHash: `0x${string}`,
  sequence: number,
): Promise<void> {
  const operationId = [
    "demo",
    expectedDirection,
    new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14),
    String(sequence).padStart(2, "0"),
    randomUUID().slice(0, 8),
  ].join("-");

  const attempt: Attempt = {operationId, direction: expectedDirection, complete: false, accessToken: randomUUID(), input: {operationId, workerAddress, transactionHashes: [transactionHash]}};
  attempts.push(attempt);
  await saveAttempts();
  console.info(`[demo] operation ${operationId}`);
  const access = await sendMessage(
    card,
    ENTRYPOINT,
    {
      operationId,
      workerAddress,
      transactionHashes: [transactionHash],
    },
    paidFetch,
    { idempotencyKey: operationId, accessToken: attempt.accessToken },
  );
  const task = await waitForTask(card, access);
  const operation = await waitForSettlement(settlementApiUrl, operationId);
  if (operation.direction !== expectedDirection) {
    throw new Error(
      `${operationId} resolved ${operation.direction}; expected ${expectedDirection} (task=${task.status})`,
    );
  }
  if (!receipts.some(r => r.operationId === operation.operationId)) receipts.push(publicReceipt(operation));
  await saveEvidence();
  attempt.complete = true;
  await saveAttempts();
  console.info(
    `[demo] ${expectedDirection} ${operation.operationId} -> ${operation.execution?.transactionHash}`,
  );
}

const selectedPath = process.env.DEMO_PATH || "both";
if (!["both", "payout", "refund"].includes(selectedPath)) throw new Error("DEMO_PATH must be both, payout or refund");
for (let index = 0; index < runsPerPath; index += 1) {
  if (selectedPath !== "refund") await runCase("payout", successTransactionHash, index + 1);
  const definitelyMissingHash = `0x${createHash("sha256")
    .update(`missing:${Date.now()}:${index}:${randomUUID()}`)
    .digest("hex")}` as `0x${string}`;
  if (selectedPath !== "payout") await runCase("refund", definitelyMissingHash, index + 1);
}

await saveEvidence();
console.info(
  `[demo] wrote ${receipts.length} verified operations to artifacts/receipts.json`,
);

}
main().catch(error => {
  const diagnostic = paymentDiagnostic(error);
  console.error(`[demo] ${diagnostic.code}: ${diagnostic.message}`);
  process.exitCode = 1;
});
