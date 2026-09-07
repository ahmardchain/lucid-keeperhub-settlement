import { serve } from "@hono/node-server";
import { serviceConfigFromEnv } from "./config";
import { createSettlementAgentService } from "./lucid/service";

const config = serviceConfigFromEnv();
const service = await createSettlementAgentService(config);

const server = serve({
  fetch: service.app.fetch,
  port: config.port,
});

console.info(
  `[lucid-settlement] listening on http://localhost:${config.port}/api/agent`,
);

async function shutdown(signal: string): Promise<void> {
  console.info(`[lucid-settlement] received ${signal}; closing`);
  server.close();
  await service.close();
  process.exit(0);
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));
