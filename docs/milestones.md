# Release checklist

## Proven live

- One paid audit and one missing-receipt refund on Base Sepolia.
- Exported incoming payment and outgoing settlement hashes, task IDs and KeeperHub execution IDs.
- Dashboard published privately; this is not yet a public judge-accessible backend.

## Implemented; validate with automated checks

- Reject zero settlement participants and invalid task inputs before payment.
- Bind operationId to Idempotency-Key before payment.
- Omit raw facilitator responses from diagnostic logs.
- Preserve existing evidence and save after each completed operation.
- Tests for failed, cancelled, expired and invalid-output tasks; duplicate settlement; simulation refusal; durable SQLite reopen.
- CI configuration runs unit tests, type checking, lint and dashboard build/tests.

## Requires a funded local run

Keep exactly one `npm run agent:dev` terminal open. In another PowerShell terminal:

```powershell
$env:DEMO_RUNS_PER_PATH="10"
npm run demo:live
Remove-Item Env:DEMO_RUNS_PER_PATH
```

This authorizes 20 new paid testnet tasks, not mainnet transactions. Keep at least 0.20 test USDC in the buyer wallet plus a buffer; ensure KeeperHub can pay network fees. Prior exported operations are retained. Do not run simultaneous demo processes against the same evidence files.

- Verify at least 10 payouts and 10 refunds, each with distinct operation and settlement IDs.
- Independently inspect each USDC Transfer event for the correct network, token, sender, recipient and amount.
- Demonstrate duplicate settlement without a second transfer.
- Demonstrate process termination after a saved execution ID, restart and recovery without a second transfer.
- Demonstrate timeout and cancellation live; automated tests are not live evidence.
- If a run fails after payment, reconcile its task and settlement before starting another paid task. Incremental export does not close the payment-to-reservation crash gap.

## Release gates still open

- Host the Node backend with HTTPS, persistent SQLite storage, restricted secrets and one replica. Do not put node:sqlite into the dashboard's Cloudflare Worker.
- Decide the hosting provider/account and public access settings. No new hosting expenditure is approved by this checklist.
- Package and test the reusable adapter in a second Lucid application; source exports alone are not a published SDK.
- Record a 2–3 minute actual demo using docs/recording-script.md.
- Check CI on the pushed release commit, scan for secrets, and create a release only after the gates pass.
- Fill the video/public dashboard links, review current hackathon rules and deadline, and obtain owner approval for the final submission.

## Out of scope for this release

Mainnet, multi-asset settlement, fee splitting, ERC-8004 registration, smart-contract escrow and a separate custom-node bounty. The settlement wallet is operator-controlled custody, not trustless escrow.
