import assert from "node:assert/strict";
import test from "node:test";
import { normalizeAddress } from "../../src/settlement/identity";
import { receiptAuditInputSchema } from "../../src/lucid/receipt-audit";

test("zero settlement participants fail closed", () => {
  assert.throws(() => normalizeAddress(`0x${"0".repeat(40)}`), /Zero address/);
  assert.throws(() => receiptAuditInputSchema.parse({
    operationId: "zero-recipient-test",
    workerAddress: `0x${"0".repeat(40)}`,
    transactionHashes: [`0x${"1".repeat(64)}`],
  }));
});
