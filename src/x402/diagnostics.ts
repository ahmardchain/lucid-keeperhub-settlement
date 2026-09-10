/** Classify private upstream errors without printing their payloads or tokens. */
export function paymentDiagnostic(error: unknown): { code: string; message: string } {
  const e = error as { responseStatus?: number; settlement?: { paymentResponse?: string }; body?: {error?: {code?: string}} };
  let detail = "";
  try {
    const decoded = JSON.parse(Buffer.from(e?.settlement?.paymentResponse ?? "", "base64").toString("utf8"));
    detail = String(decoded.errorMessage ?? "");
  } catch { /* upstream need not include an encoded response */ }
  if (/replacement transaction underpriced/i.test(detail)) return {
    code: "FACILITATOR_NONCE_CONFLICT",
    message: "The facilitator's broadcaster rejected its replacement fee. Keep this operation ID; inspect payment status before any new attempt. This is not a request to increase your task price.",
  };
  if (e?.responseStatus === 409) return {code: "RECONCILIATION_REQUIRED", message: "This operation is already recorded. Resume by reading its settlement status; do not submit a new payment."};
  if (e?.responseStatus === 503) return {code: "FACILITATOR_UNAVAILABLE", message: "Payment verification is unavailable. The attempt is preserved; run demo:resume to check whether settlement was captured."};
  if (e?.responseStatus === 402) return {code: "PAYMENT_NOT_CONFIRMED", message: "Payment was not confirmed. Preserve the operation and inspect the server journal before submitting again."};
  return {code: "DEMO_INTERRUPTED", message: "The run stopped. Its operation ID is preserved; run demo:resume to check existing settlement status."};
}
