# Demo runbook

The strongest demo shows both outcomes with real Base Sepolia hashes: a valid Lucid task pays the worker and an invalid fulfillment refunds the verified x402 payer.

## 1. Prepare accounts

Use separate addresses where possible so the route is visually unambiguous:

- buyer: signs x402 and receives refunds;
- settlement wallet: the KeeperHub organization wallet and Lucid `payTo`;
- worker: receives successful payouts.

Fund the buyer with enough Base Sepolia USDC for two paid tasks per demo pair. Fund the KeeperHub settlement wallet with Base Sepolia ETH for transfer gas. Never paste or commit the buyer private key.

## 2. Configure the service

```bash
cp .env.example .env
```

Set:

- `PAYMENTS_RECEIVABLE_ADDRESS` to the KeeperHub organization wallet;
- `KEEPERHUB_API_KEY` to an organization key with direct-write scope;
- `FACILITATOR_URL` to `https://x402.org/facilitator`, the public x402
  testnet facilitator for Base Sepolia;
- `BASE_SEPOLIA_RPC_URL` to a Base Sepolia endpoint;
- `BUYER_PRIVATE_KEY` to the funded demo payer key;
- `WORKER_PAYOUT_ADDRESS` to the worker destination;
- `DEMO_SUCCESS_TX_HASH` to an existing successful Base Sepolia transaction;
- `DEMO_RUNS_PER_PATH` to `1` for rehearsal. Extra transaction batches are optional; the hackathon has no published minimum.

The public testnet facilitator does not require a token. If you deliberately
choose an authenticated facilitator, set `PAYMENTS_FACILITATOR_AUTH` to its
server-only bearer token.

`PAYMENTS_RECEIVABLE_ADDRESS` must be able to send through the same KeeperHub organization addressed by the API key. A mismatch defeats the money path and should not be presented as an integration.

## 3. Start the paid Lucid service

```bash
npm ci
npm run agent:dev
```

Sanity-check the live agent card:

```bash
curl -fsS http://localhost:8788/api/agent/.well-known/agent-card.json
```

The card should advertise `audit_receipts` with an exact x402 offer on `eip155:84532` and the configured settlement address.

## 4. Generate payout and refund proof

In a second terminal:

```bash
npm run demo:live
```

Each pair performs:

1. **Payout:** submit `DEMO_SUCCESS_TX_HASH`; the deterministic receipt audit returns confirmed and KeeperHub pays the worker.
2. **Refund:** submit a freshly generated nonexistent hash; the audit returns missing and KeeperHub refunds the payer extracted from x402.

The runner waits for Lucid terminal state and KeeperHub receipt verification. It exits instead of publishing incomplete evidence.

## 5. Inspect the evidence

```bash
jq '.mode, .network, (.operations | length)' artifacts/receipts.json
jq -r '.operations[] | [.direction, .reasonCode, .lucidTaskId, .keeperhubExecutionId, .settlementTransactionHash] | @tsv' artifacts/receipts.json
```

Check every settlement transaction on BaseScan and confirm:

- payout recipient equals the configured worker;
- refund recipient equals the x402 payer;
- token equals Base Sepolia USDC;
- amount equals `TASK_PRICE_ATOMIC`;
- there is exactly one settlement transfer per operation.

The same bundle is copied into `public/evidence/receipts.json`; the dashboard will switch from its explicit pending state to the live ledger.

## 6. Record the failure-first video

Keep the sequence short and evidence-led:

1. Show the Lucid agent card and exact paid offer.
2. Show x402 `payTo` equals the KeeperHub settlement wallet.
3. Run one valid receipt and show the immutable payout verdict.
4. Open the KeeperHub execution and BaseScan settlement hash.
5. Run the missing-receipt case and show `RECEIPTS_NOT_CONFIRMED`.
6. Show the refund recipient matches the x402 payer—not a caller-provided field.
7. Replay the same `operationId` and show there is no second transfer.
8. End on the public receipt ledger joining all four IDs.

## Optional recovery drills

- **Duplicate settle:** call the same operation again and compare KeeperHub transfer count.
- **Bad recipient:** use an invalid worker address; Lucid schema validation should reject it before payment.
- **Simulation failure:** remove transfer gas or use an unfunded isolated KeeperHub test organization; verify state becomes `blocked` without a broadcast.
- **Crash after accepted write:** stop the process after KeeperHub returns an execution ID, restart it, and show polling resumes from SQLite without a new idempotency key.

Do not manufacture transaction hashes or label mocked test output as live evidence.

## Interrupted attempts

`npm run demo:resume` only reads saved operation IDs and exports completed evidence; it sends no payments. The runner blocks a new batch while any attempt is unresolved. `npm run reconciliation:status` inspects the server journal. Restarting the agent captures complete payment/task pairs. Unknown upstream outcomes require facilitator/onchain reconciliation; do not delete journal records or rotate operation IDs to work around this guard. Older attempts made before this journal release are not reconstructed automatically.

`npm run demo:replay` replays the latest completed attempt from this release without a payment signature and compares the saved execution/transaction. Client replay credentials live only in ignored `.data/demo-attempts.json` (mode 0600 where supported). Keep that file private. It is distinct from the server journal, which stores only credential digests.
