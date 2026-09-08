import { normalizeAddress } from "./settlement/identity";

export const BASE_SEPOLIA_USDC =
  "0x036cbd53842c5426634e7929541ec2318f3dcf7e" as const;

export interface ServiceConfig {
  port: number;
  databasePath: string;
  baseSepoliaRpcUrl: string;
  baseSepoliaUsdcAddress: `0x${string}`;
  facilitatorUrl: string;
  keeperHubApiBaseUrl: string;
  keeperHubApiKey: string;
  settlementAddress: `0x${string}`;
  taskPriceAtomic: string;
  taskDeadlineMs: number;
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = value ? Number(value) : fallback;
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`Expected a positive integer, received ${value}`);
  }
  return parsed;
}

export function serviceConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): ServiceConfig {
  const amount = env.TASK_PRICE_ATOMIC?.trim() ?? "10000";
  if (!/^\d+$/.test(amount) || BigInt(amount) <= 0n) {
    throw new Error("TASK_PRICE_ATOMIC must be a positive atomic USDC amount");
  }

  const asset = normalizeAddress(
    env.BASE_SEPOLIA_USDC_ADDRESS ?? BASE_SEPOLIA_USDC,
  );
  if (asset !== BASE_SEPOLIA_USDC) {
    throw new Error(
      `BASE_SEPOLIA_USDC_ADDRESS must be the official Base Sepolia USDC deployment: ${BASE_SEPOLIA_USDC}`,
    );
  }

  return {
    port: positiveInteger(env.PORT, 8788),
    databasePath: env.DATABASE_PATH?.trim() || ".data/settlement.db",
    baseSepoliaRpcUrl: required(env, "BASE_SEPOLIA_RPC_URL"),
    baseSepoliaUsdcAddress: asset,
    facilitatorUrl: required(env, "FACILITATOR_URL"),
    keeperHubApiBaseUrl:
      env.KEEPERHUB_API_BASE_URL?.trim() || "https://app.keeperhub.com",
    keeperHubApiKey: required(env, "KEEPERHUB_API_KEY"),
    settlementAddress: normalizeAddress(
      required(env, "PAYMENTS_RECEIVABLE_ADDRESS"),
    ),
    taskPriceAtomic: amount,
    taskDeadlineMs: positiveInteger(env.TASK_DEADLINE_MS, 60_000),
  };
}
