# Submission readiness

## Recorded live

- 8 payouts and 5 refunds in `public/evidence/receipts.json`.
- 13 KeeperHub settlements, 26 incoming/outgoing transactions; IDs and hashes join each operation.
- Public evidence website; paid Node backend runs separately on the builder's PC.
- Run `npm run evidence:verify` to verify transfer events independently.

## Implemented

- Durable signed-request intent and trusted payment receipt journal.
- Startup reconciliation for observed payment/task pairs; uncertain outcomes block replay.
- Captured request replay returns the existing task with matching owner/input.
- Concise private-data-free payment failure classification; no manual Base64 decoding.
- Read-only `demo:resume` and `reconciliation:status` commands.
- Custom deterministic output verifier and separate invoice capability consumer.
- Automated payment capture interruption/restart, payout/refund, replay, invalid-output, custody and receipt checks.
- No artificial 10/10 transaction target; `bothPathsVerified` reports evidence coverage only.

## Before the final submission

1. Run checks on the release revision. Automated fixtures are not live network evidence.
2. Pull the changes on the PC and restart the single agent process.
3. Record a real payout/refund demonstration. Existing transaction evidence is usable; do not claim a recorded historical execution is happening live.
4. Record replay/recovery if demonstrating it as live; otherwise explicitly show the automated test.
5. Add the actual public video URL, contact email and social contact. Run `npm run submission:check`.
6. Review the BUIDL and submit from the user's account. Do not claim submission until the form is accepted.

There is no published transaction-count minimum, first-submitter bonus or mainnet requirement. Official rules checked September 10: https://dorahacks.io/hackathon/agent-economy/detail. Deadline September 18, 12:00 CEST (10:00 UTC). Source, working demo video and KeeperHub transaction evidence are required. Live-project integration remains a judge-assessed criterion, not something a local test can certify.

## Known boundaries

Facilitator nonce/fee contention and outages cannot be repaired by changing the task price. If no trusted response reaches this service, payment outcome requires reconciliation. The journal prevents automatic duplicate attempts; it does not solve every distributed failure. Testnet/operator custody/single replica; no mainnet, trustless escrow, distributed execution or fee splitting. Final video and live rehearsal require the builder's PC and funded credentials.
