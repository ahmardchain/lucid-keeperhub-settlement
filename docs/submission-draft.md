# DoraHacks submission draft

Replace the bracketed links only after the funded run and video are public.

## Project name

Lucid × KeeperHub Settlement Recovery

## One-line pitch

Post-fulfillment settlement for paid Lucid agents: KeeperHub releases USDC after deterministic proof or refunds the verified x402 payer after failure.

## Problem

An asynchronous x402 task can be paid after reservation but before its work finishes. If the payment lands directly in a worker's spending wallet, a failed, cancelled, malformed, or timed-out task leaves the buyer without an automatic recovery path. Payment success and fulfillment success are different events.

## Solution

Settlement Recovery makes that timing gap explicit. Lucid's exact x402 offer pays Base Sepolia USDC into the KeeperHub organization's settlement wallet. A durable Lucid task audits receipt evidence. After the task becomes terminal, a deterministic verifier fixes one immutable outcome: payout to the worker or refund to the payer extracted from the verified x402 response. KeeperHub then simulates, executes once under an operation-derived idempotency key, and supplies the independently verified onchain receipt.

KeeperHub is not an observability add-on. It is the only component that moves USDC after the Lucid task reaches a terminal state.

## Live integrations

### Lucid Agents

- current `@lucid-agents/*` SDK packages;
- paid async A2A entrypoint: `audit_receipts`;
- exact x402 offer on `eip155:84532`;
- `payTo` set to the KeeperHub-controlled wallet;
- durable SQLite `TaskStore` with fenced execution leases;
- Lucid `Idempotency-Key` bound exactly to `operationId`.

### KeeperHub

- `POST /api/execute/transfer` with `simulate: true`;
- custody check: simulated `from` must equal Lucid `payTo`;
- same canonical transfer body for broadcast;
- stable `Idempotency-Key` derived from operation and direction;
- `GET /api/execute/{executionId}/status` recovery loop;
- terminal acceptance only for `receipts[].verified: true` plus `receiptStatus: "success"`.

## Network and asset

- Base Sepolia (`eip155:84532` / chain ID `84532`)
- Circle USDC: `0x036CbD53842c5426634e7929541eC2318f3dCF7e`
- Default task price: `0.01 USDC`

## What to inspect

- Source: https://github.com/ahmardchain/lucid-keeperhub-settlement
- Dashboard: https://lucid-keeperhub-settlement.ahmardchain.chatgpt.site
- Demo video: `[VIDEO_URL]`
- Receipt bundle: https://github.com/ahmardchain/lucid-keeperhub-settlement/blob/main/artifacts/receipts.json
- BaseScan payout example: https://sepolia.basescan.org/tx/0x7b031db5a8961388a3410833547eafc7b0fba7b6bf4f48aaec24b239f9b50a6a
- BaseScan refund example: https://sepolia.basescan.org/tx/0x689b981426e904f2495fa7b7ea9efb22cd011f3c783ce078d396504ae9d3bb83

Every receipt row joins `operationId`, `lucidTaskId`, `keeperhubExecutionId`, x402 payment transaction, and final settlement transaction.

## Evidence scope

The exported live bundle contains 8 payouts and 5 refunds: 13 KeeperHub settlement operations and 26 incoming/outgoing transactions. These counts describe the recorded live bundle, not the automated tests. `npm run evidence:verify` checks the USDC Transfer events through RPC. The dashboard is publicly accessible; the paid backend still runs separately on the builder's PC.

The installable ESM adapter tarball builds with `npm run adapter:pack`. A separate invoice consumer exercises its own Lucid capability with an application-owned verifier and the packaged adapter. Its payment and KeeperHub boundaries are fixtures, not additional live transactions. A subprocess kill/restart test proves recovery from a persisted pending execution ID without another broadcast, with KeeperHub mocked. These tests are not claimed as live onchain crash-recovery evidence.

## Live and automated cases

- valid receipt → worker payout;
- missing receipt → refund to verified x402 payer;
- duplicate settlement → no second KeeperHub transfer;
- KeeperHub sender / Lucid `payTo` mismatch → block before broadcast;
- completed execution without independently verified receipt → fail closed;
- subprocess interruption recovered by saved execution ID (automated, KeeperHub mocked);
- unresolved retry after KeeperHub's 24-hour replay window → block for manual reconciliation.

## Demo status and contacts

The video URL above is intentionally unfinished until an actual recording exists. Supply the public recording, email and X/Discord contact in the submission form. Run `npm run submission:check` with `DEMO_VIDEO_URL`, `CONTACT_EMAIL` and `CONTACT_HANDLE` set. This check does not submit anything or claim eligibility.

## Verification

The repository includes deterministic unit tests, SQLite reopen tests, KeeperHub protocol tests, UI evidence tests, and an end-to-end paid task through the real Lucid Hono runtime with mocked facilitator, RPC, and KeeperHub boundaries. The funded demo runner uses Lucid's actual A2A and x402 clients against Base Sepolia.

## Unfinished / intentionally scoped out

- mainnet and multi-asset support;
- smart-contract escrow instead of an operator-controlled settlement wallet;
- protocol-fee splitting;
- redundant RPC and confirmation-depth policy;
- distributed payment-capture storage and horizontally scaled settlement workers;
- unknown upstream payment outcomes when no trusted receipt reaches the process require operator reconciliation; observed paid task/receipt pairs are recovered from the durable journal at restart.
- no external adoption is claimed for the adapter; the invoice consumer is an integration example.
- a recorded demo video and final contact details must still be attached by the submitter.
