# Lucid KeeperHub settlement adapter

Build the installable ESM package with `npm run adapter:pack`. The tarball is in `.release/`. Install it into a Node 22.13+ application with `npm install /absolute/path/to/the.tgz`.

```js
import { createSettlementAgentService, serviceConfigFromEnv } from '@ahmardchain/lucid-keeperhub-settlement';
const service = await createSettlementAgentService(serviceConfigFromEnv());
// Mount service.app.fetch in your HTTP server; call service.close() on shutdown.
```

This factory creates the real Lucid paid receipt-audit application with durable tasks, the payment-capture middleware and KeeperHub settlement watcher. It requires the server configuration documented in the repository's `.env.example`. Keep the buyer demo key out of the server environment.

For an existing Lucid application, the package also exports `SettlementCoordinator`, `SqliteSettlementStore`, `KeeperHubHttpExecutor`, `parsePaymentEvidence` and their TypeScript interfaces. After a verified paid task is reserved, call `coordinator.reserve({task, payment, workerAddress})`; after fulfillment call `coordinator.settle(taskEvidence)`. The task and payment identity must refer to that exact reservation. Never build payment evidence from caller-supplied payer fields.

The default verifier supports the receipt-audit output schema. Other capabilities need an explicitly implemented deterministic verifier; this package does not claim arbitrary output support. The supplied service factory is the supported complete integration for this release.

Persist the database across restarts and run one service replica. Simulate before broadcast; maintain the stable operation-derived idempotency key. Do not change operation IDs to recover a failed request. The payment-to-local-reservation crash gap requires reconciliation. Base Sepolia only; operator custody, no trustless escrow or fee splitting.
