import { normalizeAddress, normalizeTransactionHash } from "../settlement/identity";
import type {
  ExecutionEvidence,
  KeeperHubExecutor,
  SettlementRequest,
  SimulationEvidence,
} from "../settlement/types";
import { USDC_DECIMALS } from "../settlement/types";

type FetchLike = typeof fetch;

interface KeeperHubHttpExecutorOptions {
  apiKey: string;
  baseUrl?: string;
  fetchImpl?: FetchLike;
  now?: () => Date;
}

type JsonRecord = Record<string, unknown>;

export class KeeperHubHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    readonly retryable?: boolean,
  ) {
    super(message);
    this.name = "KeeperHubHttpError";
  }
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function atomicToDecimal(
  amountAtomic: string,
  decimals = USDC_DECIMALS,
): string {
  if (!/^\d+$/.test(amountAtomic)) {
    throw new Error("Atomic amount must be an unsigned integer string");
  }
  const amount = BigInt(amountAtomic);
  const scale = 10n ** BigInt(decimals);
  const whole = amount / scale;
  const fraction = (amount % scale)
    .toString()
    .padStart(decimals, "0")
    .replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

function transferBody(request: SettlementRequest): JsonRecord {
  return {
    chainId: String(request.chainId),
    recipientAddress: normalizeAddress(request.recipientAddress),
    tokenAddress: normalizeAddress(request.tokenAddress),
    amount: atomicToDecimal(request.amountAtomic),
  };
}

async function responseJson(response: Response): Promise<JsonRecord> {
  const value = await response.json().catch(() => null);
  return isRecord(value) ? value : {};
}

function httpError(response: Response, body: JsonRecord): KeeperHubHttpError {
  const message =
    optionalString(body.error) ??
    optionalString(body.details) ??
    `KeeperHub returned HTTP ${response.status}`;
  return new KeeperHubHttpError(
    message,
    response.status,
    optionalString(body.code),
    typeof body.retryable === "boolean" ? body.retryable : undefined,
  );
}

function executionIdFrom(body: JsonRecord): string | undefined {
  return (
    optionalString(body.executionId) ?? optionalString(body.originalExecutionId)
  );
}

export class KeeperHubHttpExecutor implements KeeperHubExecutor {
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;
  private readonly now: () => Date;

  constructor(private readonly options: KeeperHubHttpExecutorOptions) {
    if (!options.apiKey.startsWith("kh_")) {
      throw new Error("KEEPERHUB_API_KEY must be an organization API key");
    }
    this.baseUrl = (options.baseUrl ?? "https://app.keeperhub.com").replace(
      /\/$/,
      "",
    );
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? (() => new Date());
  }

  async simulate(request: SettlementRequest): Promise<SimulationEvidence> {
    const response = await this.request("/api/execute/transfer", {
      method: "POST",
      body: JSON.stringify({ ...transferBody(request), simulate: true }),
    });
    const body = await responseJson(response);
    const evidence: SimulationEvidence = {
      success: body.success === true,
      wouldRevert: body.wouldRevert === true,
      estimatedGasUnits: optionalString(body.gasEstimate),
      fromAddress: optionalString(body.from),
      toAddress: optionalString(body.to),
      valueAtomic: optionalString(body.value),
      reason:
        optionalString(body.code) ??
        optionalString(body.revertReason) ??
        optionalString(body.error),
      observedAt: this.now().toISOString(),
    };

    // KeeperHub deliberately returns HTTP 400 for a deterministic failed dry run.
    // Preserve that structured evidence instead of flattening it into a generic error.
    if (!response.ok && !(body.status === "simulated" && "wouldRevert" in body)) {
      throw httpError(response, body);
    }
    return evidence;
  }

  async execute(request: SettlementRequest): Promise<ExecutionEvidence> {
    const response = await this.request("/api/execute/transfer", {
      method: "POST",
      headers: { "Idempotency-Key": request.idempotencyKey },
      body: JSON.stringify(transferBody(request)),
    });
    const body = await responseJson(response);
    const executionId = executionIdFrom(body);

    if (!response.ok) {
      // An in-progress response is safe only when KeeperHub tells us which
      // original execution owns the stable key; otherwise fail closed.
      if (
        response.status === 409 &&
        body.code === "idempotency_in_progress" &&
        executionId
      ) {
        return {
          keeperhubExecutionId: executionId,
          status: "pending",
          observedAt: this.now().toISOString(),
        };
      }
      throw httpError(response, body);
    }
    if (!executionId) {
      throw new Error("KeeperHub broadcast response omitted executionId");
    }

    // The broadcast response is only an acknowledgement. Even a response that
    // says "completed" or "failed" can omit the independently checked receipt
    // data. Once KeeperHub gives us an execution ID, status polling is the only
    // path to a terminal local decision.
    return {
      keeperhubExecutionId: executionId,
      status: "pending",
      observedAt: this.now().toISOString(),
    };
  }

  async getExecution(executionId: string): Promise<ExecutionEvidence> {
    const response = await this.request(
      `/api/execute/${encodeURIComponent(executionId)}/status`,
      { method: "GET" },
    );
    const body = await responseJson(response);
    if (!response.ok) throw httpError(response, body);

    const status = optionalString(body.status);
    if (!status) throw new Error("KeeperHub status response omitted status");
    const pollHint = response.headers.get("X-Poll-Interval-Hint")?.trim();
    if (
      ["pending", "running", "unconfirmed"].includes(status) ||
      (!["completed", "failed"].includes(status) && pollHint !== "0")
    ) {
      return {
        keeperhubExecutionId: executionId,
        status: "pending",
        observedAt: this.now().toISOString(),
      };
    }

    const receipts = Array.isArray(body.receipts)
      ? body.receipts.filter(isRecord)
      : [];
    const verifiedReceipt =
      receipts.length === 1 &&
      receipts[0]?.verified === true &&
      receipts[0].receiptStatus === "success"
        ? receipts[0]
        : undefined;
    const reportedHash = optionalString(body.transactionHash);
    const receiptHash = verifiedReceipt
      ? optionalString(verifiedReceipt.hash)
      : undefined;

    if (status === "completed" && verifiedReceipt && receiptHash) {
      const normalizedReceiptHash = normalizeTransactionHash(receiptHash);
      if (
        reportedHash &&
        normalizeTransactionHash(reportedHash) !== normalizedReceiptHash
      ) {
        return {
          keeperhubExecutionId: executionId,
          status: "failed",
          transactionHash: normalizedReceiptHash,
          receiptVerified: true,
          receiptStatus: "success",
          error: "KeeperHub receipt hash did not match its reported transaction hash",
          observedAt: this.now().toISOString(),
        };
      }
      return {
        keeperhubExecutionId: executionId,
        status: "completed",
        transactionHash: normalizedReceiptHash,
        receiptVerified: true,
        receiptStatus: "success",
        blockNumber:
          optionalString(verifiedReceipt.blockNumber) ??
          (typeof verifiedReceipt.blockNumber === "number"
            ? String(verifiedReceipt.blockNumber)
            : undefined),
        gasUsed: optionalString(verifiedReceipt.gasUsed),
        observedAt: this.now().toISOString(),
      };
    }

    const firstReceipt = receipts[0];
    const receiptStatus = optionalString(firstReceipt?.receiptStatus) as
      | ExecutionEvidence["receiptStatus"]
      | undefined;
    return {
      keeperhubExecutionId: executionId,
      status: "failed",
      transactionHash: reportedHash
        ? normalizeTransactionHash(reportedHash)
        : undefined,
      receiptVerified:
        typeof firstReceipt?.verified === "boolean"
          ? firstReceipt.verified
          : undefined,
      receiptStatus,
      error:
        optionalString(body.error) ??
        (status === "completed"
          ? "KeeperHub completion lacked a verified successful receipt"
          : `KeeperHub execution ended with status ${status}`),
      observedAt: this.now().toISOString(),
    };
  }

  private request(path: string, init: RequestInit): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${this.options.apiKey}`);
    headers.set("Accept", "application/json");
    if (init.body) headers.set("Content-Type", "application/json");
    return this.fetchImpl(`${this.baseUrl}${path}`, { ...init, headers });
  }
}
