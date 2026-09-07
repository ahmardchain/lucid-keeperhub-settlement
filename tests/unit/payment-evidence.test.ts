import assert from "node:assert/strict";
import test from "node:test";
import { parsePaymentEvidence } from "../../src/x402/payment-evidence";

const PAYER = `0x${"11".repeat(20)}`;
const SETTLEMENT = `0x${"22".repeat(20)}` as `0x${string}`;
const USDC = `0x${"33".repeat(20)}` as `0x${string}`;
const TX = `0x${"44".repeat(32)}`;

function encode(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64");
}

test("derives refund identity only from the settled x402 response", () => {
  const evidence = parsePaymentEvidence({
    paymentResponseHeader: encode({
      success: true,
      payer: PAYER,
      transaction: TX,
      network: "eip155:84532",
      amount: "10000",
    }),
    expectedNetwork: "eip155:84532",
    expectedAssetAddress: USDC,
    expectedAmountAtomic: "10000",
    settlementAddress: SETTLEMENT,
  });
  assert.equal(evidence.payerAddress, PAYER);
  assert.equal(evidence.paymentTransactionHash, TX);
  assert.match(evidence.facilitatorReference, /^x402:[a-f0-9]{64}$/);
});

test("rejects a response for a different network or amount", () => {
  assert.throws(
    () =>
      parsePaymentEvidence({
        paymentResponseHeader: encode({
          success: true,
          payer: PAYER,
          transaction: TX,
          network: "eip155:8453",
          amount: "10000",
        }),
        expectedNetwork: "eip155:84532",
        expectedAssetAddress: USDC,
        expectedAmountAtomic: "10000",
        settlementAddress: SETTLEMENT,
      }),
    /network does not match/,
  );
});
