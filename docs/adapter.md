# Lucid KeeperHub settlement adapter

`npm run adapter:pack` creates `.release/ahmardchain-lucid-keeperhub-settlement-0.1.0.tgz` with ESM JavaScript and TypeScript declarations. Install with `npm install /absolute/path/to/the.tgz` on Node 22.13+.

## Complete paid receipt-audit service

```js
import {createSettlementAgentService, serviceConfigFromEnv} from '@ahmardchain/lucid-keeperhub-settlement';
const service = await createSettlementAgentService(serviceConfigFromEnv());
// Mount service.app.fetch in your HTTP server. Await service.close() on exit.
```

This creates the paid Lucid capability, durable tasks, capture journal and settlement watcher. Configure the values in `.env.example`; keep the buyer private key out of the server deployment. Run one replica and keep SQLite on persistent storage. The scoped fetch observer reads only this service's facilitator settlement responses; it does not retry money requests.

## Existing Lucid application

The coordinator accepts `verifier: withOutputVerifier('your-policy/v1', acceptsOutput)`. The callback must return a boolean synchronously. Throwing or returning false rejects the output. Cancellation, failure and elapsed deadlines remain enforced before the application callback. Choose a deterministic policy meaningful for your task; a schema alone does not prove arbitrary work is correct.

Exported building blocks: `SettlementCoordinator`, `SqliteSettlementStore`, `SqliteTaskStore`, `SettlementWatcher`, `KeeperHubHttpExecutor`, `parsePaymentEvidence` and `withOutputVerifier`.

1. Keep your own Lucid capability and runtime.
2. After trusted incoming payment and durable task reservation, call `coordinator.reserve({task, payment, workerAddress})` with matching identity.
3. Feed persisted terminal task evidence to `coordinator.settle(taskEvidence)` or use `SettlementWatcher` with the provided stores.
4. Save the operation ID and reuse it on replay; never trust payment evidence supplied by the caller.

`examples/invoice-consumer/app.mjs` is an executable example of a **different** capability: invoice arithmetic validation. `npm run adapter:test` installs the tarball into a clean temporary project outside this repository, creates real Lucid tasks and checks payout, refund and replay. External payment and KeeperHub services are fixtures. Installation needs registry access; this is not a live-money test or proof of third-party adoption.

The complete capture journal is wired into the bundled paid service. A custom application using only the coordinator must connect its own durable payment admission/capture lifecycle; importing the coordinator does not automatically intercept its payments.

## Recovery boundaries

Before a signed paid request is forwarded, its operation and credential/input digests are written to SQLite. No signing keys or signed authorizations are stored. Trusted facilitator receipt and task ID observations are persisted. A restart reconciles complete pairs before monitoring settlement. Replaying a captured operation with the same input and access token returns the existing task without invoking x402 again; changed input/owner is rejected.

An interrupted request with no trusted payment receipt remains pending. `npm run reconciliation:status` lists it without secrets. The server blocks replay; do not delete the row or generate a new operation to assume payment did not occur. Reconcile with the facilitator and chain first. Automatic resolution of unknown external outcomes is intentionally not claimed.

Base Sepolia only. Operator-controlled custody. No trustless escrow or fee splitting.
