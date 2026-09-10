import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { BASE_SEPOLIA_USDC } from "../src/config";
import { normalizeAddress, normalizeTransactionHash } from "../src/settlement/identity";

const rpc = process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org";
async function call<T>(method: string, params: unknown[]): Promise<T> {
  const response = await fetch(rpc, { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`RPC HTTP ${response.status}`);
  const body = await response.json() as { error?: unknown; result: T };
  if (body.error) throw new Error(`RPC failed: ${method}`);
  return body.result;
}
assert.equal(BigInt(await call<string>("eth_chainId", [])), 84532n, "Wrong RPC network");
const bundle = JSON.parse(await readFile(process.argv[2] || "artifacts/receipts.json", "utf8"));
assert.equal(bundle.mode, "base_sepolia_live");
assert.equal(bundle.network, "eip155:84532");
assert.ok(Array.isArray(bundle.operations) && bundle.operations.length > 0);
const transferTopic = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
type Log = { address: string; topics: string[]; data: string };
type Receipt = { status: string; transactionHash: string; blockNumber: string; logs: Log[] };
const unique = new Set<string>();
let payouts = 0;
let refunds = 0;
for (const operation of bundle.operations) {
  for (const field of ["operationId", "lucidTaskId", "keeperhubExecutionId", "paymentTransactionHash", "settlementTransactionHash"]) {
    assert.ok(typeof operation[field] === "string" && operation[field].length > 0, `Missing ${field}`);
    const key = `${field}:${operation[field].toLowerCase()}`;
    assert.ok(!unique.has(key), `Duplicate ${field}`);
    unique.add(key);
  }
  const amount = BigInt(operation.amountAtomic);
  assert.ok(amount > 0n);
  const payer = normalizeAddress(operation.payerAddress);
  const recipient = normalizeAddress(operation.recipientAddress);
  const receipts = [];
  for (const hash of [operation.paymentTransactionHash, operation.settlementTransactionHash]) {
    const receipt = await call<Receipt | null>("eth_getTransactionReceipt", [normalizeTransactionHash(hash)]);
    assert.ok(receipt && receipt.status === "0x1", `Unsuccessful or missing transaction ${hash}`);
    assert.equal(receipt.transactionHash.toLowerCase(), hash.toLowerCase());
    receipts.push(receipt);
  }
  const transfers = receipts.map(receipt => (receipt.logs as Log[]).filter(log =>
    log.address.toLowerCase() === BASE_SEPOLIA_USDC && log.topics[0]?.toLowerCase() === transferTopic && log.topics.length === 3)
    .map(log => ({ from: `0x${log.topics[1].slice(-40)}`.toLowerCase(),
      to: `0x${log.topics[2].slice(-40)}`.toLowerCase(), amount: BigInt(log.data) })));
  const incoming = transfers[0].filter(t => t.from === payer && t.amount === amount);
  assert.equal(incoming.length, 1, "Payment must contain one matching USDC transfer");
  const settlement = incoming[0].to;
  if (process.env.PAYMENTS_RECEIVABLE_ADDRESS) assert.equal(settlement, normalizeAddress(process.env.PAYMENTS_RECEIVABLE_ADDRESS));
  assert.ok(transfers[1].some(t => t.from === settlement && t.to === recipient && t.amount === amount), "Settlement transfer mismatch");
  assert.ok(BigInt(receipts[1].blockNumber) >= BigInt(receipts[0].blockNumber));
  assert.equal(operation.receiptVerified, true);
  assert.equal(operation.receiptStatus, "success");
  if (operation.direction === "refund") {
    assert.equal(operation.state, "refunded"); assert.equal(recipient, payer); refunds++;
  } else {
    assert.equal(operation.direction, "payout"); assert.equal(operation.state, "paid"); payouts++;
  }
  console.info(`Verified ${operation.direction}: ${operation.operationId}`);
}
console.info(JSON.stringify({ payouts, refunds, transactions: bundle.operations.length * 2, targetMet: payouts >= 10 && refunds >= 10 }));
