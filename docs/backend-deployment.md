# Backend deployment

The dashboard is a Cloudflare Worker. The paid agent uses Node and persistent SQLite, and is deployed separately.

The repository provides `Dockerfile.agent`. Build with `docker build -f Dockerfile.agent -t lucid-settlement-agent .`. Run one replica with a persistent volume mounted at `/data`, port 8788, and HTTPS provided by the hosting platform/reverse proxy. Do not deploy SQLite on an ephemeral filesystem or share it between replicas.

Set server-only secrets using the hosting provider's environment settings: `KEEPERHUB_API_KEY`, `PAYMENTS_RECEIVABLE_ADDRESS`, `BASE_SEPOLIA_RPC_URL`, `FACILITATOR_URL`, and optional facilitator authentication. Never upload `BUYER_PRIVATE_KEY` to the agent host. The buyer remains a separate client on your PC.

Use the repository's `.env.example` for the remaining defaults. The settlement address must be the wallet controlled by your KeeperHub organization. Enable platform automatic restarts and persistent-volume backups. Expose only the HTTPS service; the settlement ledger endpoints contain public task/payment metadata.

After deployment, set `AGENT_URL=https://YOUR_HOST/api/agent` and `SETTLEMENT_API_URL=https://YOUR_HOST/api/settlements` on the buyer PC. Run one payout/refund pair, then restart the backend and verify its existing operations survive before running the larger batch.

No backend hosting account or server secrets are configured in this workspace. The Docker definition is prepared; a successful container build and live deployment are still required. Hosting costs require the owner's chosen provider/plan.
