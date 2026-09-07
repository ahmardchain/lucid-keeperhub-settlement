export const BASE_SEPOLIA_CHAIN_ID = 84532;
export const USDC_DECIMALS = 6;

export const terminalOutcomes = [
  "success",
  "failed",
  "invalid_output",
  "expired",
  "cancelled",
] as const;

export type TerminalOutcome = (typeof terminalOutcomes)[number];
export type SettlementDirection = "payout" | "refund";

export const operationStates = [
  "reserved",
  "running",
  "verifying",
  "settling_payout",
  "settling_refund",
  "paid",
  "refunded",
  "blocked",
  "settlement_failed",
] as const;

export type OperationState = (typeof operationStates)[number];

export interface PaymentEvidence {
  network: `eip155:${number}`;
  assetAddress: `0x${string}`;
  amountAtomic: string;
  payerAddress: `0x${string}`;
  settlementAddress: `0x${string}`;
  paymentTransactionHash: `0x${string}`;
  facilitatorReference: string;
}

export interface LucidTaskEvidence {
  operationId: string;
  lucidTaskId: string;
  lucidRunId: string;
  entrypoint: string;
  status: "completed" | "failed" | "cancelled" | "running";
  reservedAt: string;
  deadlineAt: string;
  completedAt?: string;
  output?: unknown;
  failureCode?: string;
}

export interface VerificationResult {
  outcome: TerminalOutcome;
  reasonCode:
    | "OUTPUT_VALID"
    | "RECEIPTS_NOT_CONFIRMED"
    | "TASK_FAILED"
    | "OUTPUT_SCHEMA_INVALID"
    | "DEADLINE_EXCEEDED"
    | "TASK_CANCELLED";
  explanation: string;
  verifierVersion: string;
  verifiedAt: string;
  outputDigest?: string;
}

export interface SettlementRequest {
  operationId: string;
  direction: SettlementDirection;
  chainId: typeof BASE_SEPOLIA_CHAIN_ID;
  tokenAddress: `0x${string}`;
  recipientAddress: `0x${string}`;
  amountAtomic: string;
  idempotencyKey: string;
  lucidTaskId: string;
  reasonCode: VerificationResult["reasonCode"];
}

export interface SimulationEvidence {
  success: boolean;
  wouldRevert: boolean;
  estimatedGasUnits?: string;
  fromAddress?: string;
  toAddress?: string;
  valueAtomic?: string;
  reason?: string;
  observedAt: string;
}

export interface ExecutionEvidence {
  keeperhubExecutionId: string;
  status: "pending" | "completed" | "failed";
  transactionHash?: `0x${string}`;
  receiptVerified?: boolean;
  receiptStatus?:
    | "success"
    | "reverted"
    | "safe_inner_failure"
    | "not_found"
    | "timeout";
  blockNumber?: string;
  gasUsed?: string;
  error?: string;
  observedAt: string;
}

export interface SettlementOperation {
  operationId: string;
  lucidTaskId: string;
  lucidRunId: string;
  entrypoint: string;
  deadlineAt: string;
  state: OperationState;
  payment: PaymentEvidence;
  workerAddress: `0x${string}`;
  verification?: VerificationResult;
  direction?: SettlementDirection;
  idempotencyKey?: string;
  simulation?: SimulationEvidence;
  execution?: ExecutionEvidence;
  createdAt: string;
  updatedAt: string;
}

export interface SettlementStore {
  get(operationId: string): Promise<SettlementOperation | null>;
  listRecoverable(): Promise<SettlementOperation[]>;
  create(operation: SettlementOperation): Promise<SettlementOperation>;
  claimTerminalDecision(
    operationId: string,
    verification: VerificationResult,
    direction: SettlementDirection,
    idempotencyKey: string,
  ): Promise<{ operation: SettlementOperation; claimed: boolean }>;
  recordSimulation(
    operationId: string,
    simulation: SimulationEvidence,
  ): Promise<SettlementOperation>;
  recordExecution(
    operationId: string,
    execution: ExecutionEvidence,
  ): Promise<SettlementOperation>;
}

export interface KeeperHubExecutor {
  simulate(request: SettlementRequest): Promise<SimulationEvidence>;
  execute(request: SettlementRequest): Promise<ExecutionEvidence>;
  getExecution(executionId: string): Promise<ExecutionEvidence>;
}
