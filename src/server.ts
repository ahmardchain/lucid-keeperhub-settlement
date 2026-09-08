import { serve } from "@hono/node-server";
import { serviceConfigFromEnv } from "./config";
import { createSettlementAgentService } from "./lucid/service";

const config = serviceConfigFromEnv();
const originalFetch = globalThis.fetch;
const facilitatorBaseUrl = config.facilitatorUrl.replace(/\/$/u, "");

// Lucid intentionally returns a generic 503 when a facilitator rejects or
// cannot inspect a payment. Log only a bounded reason code: upstream error
// messages can echo signed payment authorizations and must remain private.
globalThis.fetch = async (input, init) => {
  const requestUrl =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;
  const response = await originalFetch(input, init);
  if (
    requestUrl.startsWith(`${facilitatorBaseUrl}/`) &&
    (requestUrl.endsWith("/verify") || requestUrl.endsWith("/settle"))
  ) {
    const body = await response
      .clone()
      .json()
      .catch(() => undefined) as Record<string, unknown> | undefined;
    if (!response.ok || body?.isValid === false || body?.success === false) {
      console.error(
        `[x402:facilitator] ${response.status} ${new URL(requestUrl).pathname}`,
        { isValid: body?.isValid, success: body?.success,
          reason: typeof body?.invalidReason === "string" && /^[a-z0-9_]{1,120}$/i.test(body.invalidReason)
            ? body.invalidReason : "upstream_failure" },
      );
    }
  }
  return response;
};

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
  globalThis.fetch = originalFetch;
  process.exit(0);
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));
