# Demo recording guide

Record the actual running application. Hide environment files, private keys, API keys, access tokens and desktop notifications. Do not substitute mocked tests for live demonstrations.

## 0:00–0:25 — Problem and money path

Explain that x402 payment can happen before asynchronous work finishes. Show the dashboard's money path: buyer to KeeperHub-controlled settlement wallet, then verified worker payout or buyer refund. State that this is Base Sepolia test USDC and operator-controlled custody, not smart-contract escrow.

## 0:25–1:05 — Successful work

Run one live successful audit. Show its task ID, operation ID and KeeperHub execution ID. Open the incoming payment and outgoing payout in the block explorer. Point out the worker recipient and USDC amount.

## 1:05–1:45 — Failure and refund

Show the missing-receipt task and deterministic failure reason. Open its refund transaction and compare the refund recipient to the verified buyer. Explain that no LLM chooses the payout destination.

## 1:45–2:15 — Recovery evidence

Show an actual recorded replay or restart recovery if available, including the unchanged execution ID and absence of a second transfer. Otherwise label the automated test clearly and say the live recovery demonstration is still pending.

## 2:15–2:45 — Reuse and limits

Show source entrypoints and the receipts bundle. State the current live operation count from the bundle, not the target count. Close with limitations: mainnet, fee splits, trustless escrow and the payment-to-reservation reconciliation gap.

Upload the finished video only after reviewing it for secrets. Copy the public link into the submission draft; verify access while signed out.
