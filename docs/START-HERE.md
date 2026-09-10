# Settlement Recovery — keep building from your PC

Your GitHub repository is the durable source of this project:
https://github.com/ahmardchain/lucid-keeperhub-settlement

Public dashboard: https://lucid-keeperhub-settlement.ahmardchain.chatgpt.site

## Save your working copy

In PowerShell, inside `C:\lucid-keeperhub-settlement`:

```powershell
git status --short
git pull --ff-only
npm ci
```

If Git reports conflicting local changes, stop and preserve those files before resolving them. Keep a private backup of your local environment file and SQLite data files. Never commit private keys or API tokens. The public repository cannot restore your private configuration.

## What is finished

- Public editorial website with animated payout/refund trace and real receipt links.
- Paid Lucid async agent integrated with KeeperHub settlement and refund execution.
- One real payout and one real refund with incoming/outgoing transaction evidence.
- Durable SQLite recovery, deterministic verification and idempotency checks.
- Installable adapter package, automated tests and CI workflow.
- Backend Docker definition, deployment guide, submission text and recording script.

## Finish the evidence on your PC

Use exactly one server terminal:

```powershell
npm run agent:dev
```

Keep it open. In a second terminal in the same project:

```powershell
$env:DEMO_RUNS_PER_PATH="10"
npm run demo:live
Remove-Item Env:DEMO_RUNS_PER_PATH
npm run evidence:verify
```

This starts 20 paid testnet tasks, requiring at least 0.20 test USDC plus a buffer in the buyer wallet and network-fee funding for KeeperHub. It is optional additional evidence, not proof already collected. If a paid task fails, reconcile its operation before retrying; do not launch concurrent demo runners. The existing receipt bundle is retained.

After successful verification, inspect and commit only the public evidence:

```powershell
git diff -- public/evidence/receipts.json artifacts/receipts.json
git add public/evidence/receipts.json artifacts/receipts.json
git commit -m "Add verified live settlement evidence"
git push origin main
```

Updating GitHub does not automatically update the deployed Sites dashboard. Use GitHub's receipt bundle as the source of truth until the website is republished.

## Validate and package without this chat

```powershell
npm run test:unit
npm run adapter:test
```

The adapter tarball is generated in `.release`. Dashboard build commands currently use Bash: run them in Git Bash/WSL or use the repository's GitHub Actions workflow. The paid agent commands above run in PowerShell.

## Record and submit

1. Follow `docs/recording-script.md`; record the real terminal payout and refund plus the public dashboard.
2. Upload the recording and insert its URL in `docs/submission-draft.md`.
3. Describe the evidence honestly: automated mocked recovery tests are separate from live onchain recovery demonstrations.
4. Verify the current event rules and deadline at https://dorahacks.io/hackathon/agent-economy/detail before submitting through your account.

For a hosted paid backend, follow `docs/backend-deployment.md`. It needs a Node host with persistent storage and your server secrets. The dashboard alone does not host the paid agent. No paid hosting plan has been selected or purchased.

## Handoff to another coding assistant

Use this instruction in the repository:

> Read docs/START-HERE.md, docs/milestones.md, docs/backend-deployment.md and docs/submission-draft.md. Preserve the existing live evidence and paper/ink/orange editorial UI. Inspect the actual code before changing it. Finish the outstanding release gates with available credentials, never fabricate transactions or claim mocked tests are live proof. Never print or commit secrets. Do not replace the real Lucid/KeeperHub integrations with mocks in production.

The open gates are funded batch and live recovery evidence, backend hosting, an actual recorded video and final submission. These require the owner's PC, accounts or credentials; they are not completed by this handoff.
