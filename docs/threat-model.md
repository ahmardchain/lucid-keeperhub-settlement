# Threat model

This document separates what Settlement Recovery proves from what its MVP still trusts.

## Protected assets

- x402 USDC held between payment settlement and the final payout/refund;
- the mapping between buyer payment, Lucid task, worker, and settlement transfer;
- the one-time nature and direction of each KeeperHub write;
- public evidence used to claim a successful demo.

## Trusted components

| Component | Trust placed in it |
| --- | --- |
| x402 facilitator | Correctly verifies the payment authorization and reports payer, network, amount, and settlement transaction |
| Base Sepolia RPC | Returns the canonical chain ID and transaction receipts used by the Lucid capability |
| Lucid runtime | Enforces the paid entrypoint contract and persists task transitions through the supplied durable store |
| Local process and SQLite host | Keep configuration secrets private and preserve captured payment/task state |
| KeeperHub organization | Controls the settlement wallet, signs only authorized transfers, and reports independently verified receipts |

Because the KeeperHub organization controls the wallet, this is a custodial settlement policy—not trustless escrow.

## Invariants

### Payment binding

- The accepted network is exactly `eip155:84532`.
- The accepted asset is the configured Base Sepolia USDC address.
- Lucid's `payTo` and captured settlement address must equal the configured KeeperHub wallet.
- KeeperHub's simulation must report that same wallet as its `from` address before broadcast.
- `operationId` must exactly equal the Lucid request's `Idempotency-Key`.
- A payment transaction and a Lucid task can each back only one stored settlement operation.

### Refund safety

- There is no `refundAddress` field in task input.
- The refund recipient comes only from the successful x402 payment response.
- The payer address is normalized and checked again before a refund request is built.

### Decision safety

- `running` cannot settle before its deadline.
- A completion without a valid `completedAt` at or before the deadline refunds.
- Output must contain one unique receipt record per requested hash.
- Receipt verdict counts must match the detailed receipt list.
- Any failed or missing audited receipt refunds.
- Once persisted, the verification result and payout/refund direction cannot change.

### Execution safety

- The intended transfer is simulated first.
- Failed or reverting simulations stop before broadcast.
- The idempotency key is derived from operation identity and direction, not an attempt number.
- A crash before saving the execution ID retries the same body under the same key.
- If that uncertain write is still unresolved after KeeperHub's 24-hour replay window, the operation blocks instead of rebroadcasting.
- A saved execution ID is polled; it is never broadcast again under a new key.
- Neither a broadcast response nor its self-reported transaction hash proves completion.
- Only a status response with a `verified: true`, `receiptStatus: "success"` receipt can produce `paid` or `refunded`.

## Failure cases

| Failure | Behavior | Residual action |
| --- | --- | --- |
| Invalid output, task failure, cancellation, or deadline | Immutable refund decision | KeeperHub returns funds to verified payer |
| Simulation revert | `blocked`, no broadcast | Operator fixes balance/gas/configuration and starts a new valid operation if appropriate |
| Network loss after broadcast | Persisted execution ID is polled; a pre-persist retry uses the same key | Restart recovery resumes recoverable operations |
| Unsaved execution older than 24 hours | `blocked`, no retry outside KeeperHub's replay window | Reconcile the settlement wallet and KeeperHub history manually |
| KeeperHub terminal failure | `settlement_failed` | Operator investigates; no automatic recipient/key mutation |
| Unverified or absent KeeperHub receipt | Fail closed | Do not claim payout/refund finality |
| Crash after payment and before reservation | Funds remain at settlement wallet | Reconcile from x402/facilitator and wallet records |
| RPC lies or is eclipsed | The task verdict can be wrong | Production deployment should use redundant RPCs and a confirmation policy |
| SQLite host loss | Local task/decision mapping can be lost | Production deployment needs replicated durable storage and backups |

## Out of scope for this release

- malicious or compromised KeeperHub organization operators;
- smart-contract-enforced escrow;
- multi-chain, multi-asset, mainnet, or bridge risk;
- sanctions, identity, tax, or marketplace dispute processes;
- decentralized RPC consensus or reorg-depth confirmation;
- protocol-fee splitting and multi-recipient payout atomicity.

## Payment capture journal

Signed requests are durably recorded before forwarding. Task IDs and trusted facilitator success receipts are stored before returning to the client. Startup reconciles complete pairs, and captured operation replay is bound to the same credential/input digests without another payment. Unknown upstream outcomes are retained and blocked, not guessed unpaid. The service cannot guarantee reconciliation if the facilitator accepted a broadcast but its response was lost before observation. The journal stores no access tokens or signed payment authorizations. Historical attempts before this version are not backfilled automatically.
