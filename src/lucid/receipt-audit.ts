import { z } from "zod";

const transactionHash = z.string().regex(/^0x[a-fA-F0-9]{64}$/);

export const receiptAuditInputSchema = z.object({
  operationId: z
    .string()
    .min(20)
    .max(128)
    .regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]+$/),
  workerAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/).refine(
    (value) => !/^0x0{40}$/i.test(value), "Worker must not be the zero address",
  ),
  transactionHashes: z
    .array(transactionHash)
    .min(1)
    .max(20)
    .refine(
      (hashes) =>
        new Set(hashes.map((hash) => hash.toLowerCase())).size === hashes.length,
      "transaction hashes must be unique",
    ),
});

const auditedReceiptSchema = z.object({
  transactionHash,
  verdict: z.enum(["confirmed", "failed", "missing"]),
  blockNumber: z.string().optional(),
  gasUsed: z.string().optional(),
});

export const receiptAuditOutputSchema = z.object({
  requested: z.number().int().min(1).max(20),
  confirmed: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  missing: z.number().int().nonnegative(),
  transactionHashes: z.array(transactionHash).min(1).max(20),
  receipts: z.array(auditedReceiptSchema).min(1).max(20),
});

export type ReceiptAuditInput = z.infer<typeof receiptAuditInputSchema>;
export type ReceiptAuditOutput = z.infer<typeof receiptAuditOutputSchema>;

interface RpcReceipt {
  transactionHash?: string;
  blockNumber?: string;
  gasUsed?: string;
  status?: string;
}

interface ReceiptRpcResponse {
  jsonrpc?: string;
  id?: number;
  result?: RpcReceipt | null;
  error?: { code?: number; message?: string };
}

async function rpcRequest<T>(
  rpcUrl: string,
  method: string,
  params: unknown[],
  id: number,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
    signal,
  });
  if (!response.ok) throw new Error(`Base Sepolia RPC returned ${response.status}`);
  const body = (await response.json()) as ReceiptRpcResponse;
  if (body.error) {
    throw new Error(
      `Base Sepolia RPC ${method} failed: ${body.error.message ?? body.error.code ?? "unknown"}`,
    );
  }
  return body.result as T;
}

export async function auditBaseSepoliaReceipts(
  input: ReceiptAuditInput,
  rpcUrl: string,
  signal?: AbortSignal,
): Promise<ReceiptAuditOutput> {
  const chainId = await rpcRequest<string>(rpcUrl, "eth_chainId", [], 1, signal);
  if (Number.parseInt(chainId, 16) !== 84532) {
    throw new Error(`RPC is not Base Sepolia (received ${chainId})`);
  }

  const receipts = await Promise.all(
    input.transactionHashes.map(async (hash, index) => {
      const receipt = await rpcRequest<RpcReceipt | null>(
        rpcUrl,
        "eth_getTransactionReceipt",
        [hash],
        index + 2,
        signal,
      );
      if (!receipt) {
        return { transactionHash: hash, verdict: "missing" as const };
      }
      if (
        receipt.transactionHash &&
        receipt.transactionHash.toLowerCase() !== hash.toLowerCase()
      ) {
        throw new Error("RPC receipt hash does not match the requested transaction");
      }
      return {
        transactionHash: hash,
        verdict: receipt.status === "0x1" ? ("confirmed" as const) : ("failed" as const),
        blockNumber: receipt.blockNumber,
        gasUsed: receipt.gasUsed,
      };
    }),
  );

  return {
    requested: receipts.length,
    confirmed: receipts.filter((receipt) => receipt.verdict === "confirmed").length,
    failed: receipts.filter((receipt) => receipt.verdict === "failed").length,
    missing: receipts.filter((receipt) => receipt.verdict === "missing").length,
    transactionHashes: [...input.transactionHashes],
    receipts,
  };
}
