import assert from "node:assert/strict";
import {mkdtempSync, rmSync} from "node:fs";
import {join} from "node:path";
import {tmpdir} from "node:os";
import test from "node:test";
import {PaymentJournal} from "../../src/lucid/payment-journal";
import {paymentDiagnostic} from "../../src/x402/diagnostics";
import {withOutputVerifier} from "../../src/settlement/output-verifier";

test("unknown payment intent survives restart and rejects replacement task identity", () => {
  const dir = mkdtempSync(join(tmpdir(), "intent-"));
  const path = join(dir, "db");
  let journal = new PaymentJournal(path);
  try {
    journal.begin({operationId: "intent-1", requestDigest: "hash", ownerDigest: "owner-hash", entrypoint: "invoice",
      workerAddress: `0x${"11".repeat(20)}`, reservedAt: new Date().toISOString(), deadlineAt: new Date().toISOString(), state: "pending"});
    journal.update("intent-1", {taskId: "task-1"});
    journal.close(); journal = new PaymentJournal(path);
    assert.equal(journal.pending().length, 1);
    assert.equal(journal.pending()[0].payment, undefined);
    assert.throws(() => journal.update("intent-1", {taskId: "task-2"}), /conflict/);
    assert.equal(journal.get("intent-1")?.taskId, "task-1");
  } finally { journal.close(); rmSync(dir,{recursive:true,force:true}); }
});

test("diagnostics explain underpriced errors without leaking upstream data", () => {
  const error = {accessToken: "SECRET", settlement: {paymentResponse: Buffer.from(JSON.stringify({errorMessage: "secret authorization; Details: replacement transaction underpriced"})).toString("base64")}};
  const diagnostic = paymentDiagnostic(error);
  assert.equal(diagnostic.code, "FACILITATOR_NONCE_CONFLICT");
  assert.doesNotMatch(JSON.stringify(diagnostic), /SECRET|secret authorization/);
});

test("custom capability verifier cannot bypass task failure or deadline", () => {
  const verify = withOutputVerifier("invoice/v1", () => true);
  const task = {operationId:"a",lucidTaskId:"b",lucidRunId:"b",entrypoint:"invoice",status:"completed" as const,
    reservedAt:"2026-09-10T00:00:00Z", deadlineAt:"2026-09-10T00:01:00Z",completedAt:"2026-09-10T00:00:30Z",output:{invoice:"ok"}};
  assert.equal(verify(task,new Date()).outcome,"success");
  assert.equal(verify({...task,status:"failed"},new Date()).outcome,"failed");
  assert.equal(verify({...task,completedAt:"2026-09-10T00:02:00Z"},new Date()).outcome,"expired");
  assert.equal(withOutputVerifier("bad/v1",()=>{throw new Error("bad")})(task,new Date()).outcome,"invalid_output");
});
