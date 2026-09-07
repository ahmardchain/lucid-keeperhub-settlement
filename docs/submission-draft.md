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
- Dashboard: `[PUBLIC_DASHBOARD_URL]`
- Demo video: `[VIDEO_URL]`
- Receipt bundle: `[REPOSITORY_LINK_TO_ARTIFACTS_RECEIPTS_JSON]`
- BaseScan payout example: `[PAYOUT_TX_URL]`
- BaseScan refund example: `[REFUND_TX_URL]`

Every receipt row joins `operationId`, `lucidTaskId`, `keeperhubExecutionId`, x402 payment transaction, and final settlement transaction.

## Failure cases demonstrated

- valid receipt → worker payout;
- missing receipt → refund to verified x402 payer;
- duplicate settlement → no second KeeperHub transfer;
- KeeperHub sender / Lucid `payTo` mismatch → block before broadcast;
- completed execution without independently verified receipt → fail closed;
- uncertain execution recovered by saved execution ID or stable key;
- unresolved retry after KeeperHub's 24-hour replay window → block for manual reconciliation.

## Verification

The repository includes deterministic unit tests, SQLite reopen tests, KeeperHub protocol tests, UI evidence tests, and an end-to-end paid task through the real Lucid Hono runtime with mocked facilitator, RPC, and KeeperHub boundaries. The funded demo runner uses Lucid's actual A2A and x402 clients against Base Sepolia.

## Unfinished / intentionally scoped out

- mainnet and multi-asset support;
- smart-contract escrow instead of an operator-controlled settlement wallet;
- protocol-fee splitting;
- redundant RPC and confirmation-depth policy;
- distributed payment-capture storage and horizontally scaled settlement workers;
- automated reconciliation for the narrow crash window between x402 settlement and local reservation.
