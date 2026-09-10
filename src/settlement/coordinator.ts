import {
  assertPayerOwnsRefundDestination,
  assertPositiveAtomicAmount,
  normalizeAddress,
  normalizeTransactionHash,
} from "./identity";
import { settlementIdempotencyKey } from "./idempotency";
import { directionForOutcome, isFinalState } from "./state-machine";
import type {
  KeeperHubExecutor,
  LucidTaskEvidence,
  PaymentEvidence,
  SettlementOperation,
  SettlementRequest,
  SettlementStore,
} from "./types";
import { BASE_SEPOLIA_CHAIN_ID } from "./types";
import { verifyLucidTask } from "./verifier";

const KEEPERHUB_IDEMPOTENCY_WINDOW_MS = 24 * 60 * 60 * 1_000;

export interface SettlementCoordinatorOptions {
  store: SettlementStore;
  executor: KeeperHubExecutor;
  settlementAddress: `0x${string}`;
  usdcAddress: `0x${string}`;
  pollIntervalMs?: number;
  maxPollAttempts?: number;
  sleep?: (milliseconds: number) => Promise<void>;
  now?: () => Date;
  verifier?: typeof verifyLucidTask;
}

export interface ReserveOperationInput {
  task: Pick<
    LucidTaskEvidence,
    | "operationId"
    | "lucidTaskId"
    | "lucidRunId"
    | "entrypoint"
    | "reservedAt"
    | "deadlineAt"
  >;
  payment: PaymentEvidence;
  workerAddress: `0x${string}`;
}

export class SettlementCoordinator {
  private readonly pollIntervalMs: number;
  private readonly maxPollAttempts: number;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly now: () => Date;

  constructor(private readonly options: SettlementCoordinatorOptions) {
    this.pollIntervalMs = options.pollIntervalMs ?? 1_000;
    this.maxPollAttempts = options.maxPollAttempts ?? 20;
    this.sleep =
      options.sleep ??
      ((milliseconds) =>
        new Promise((resolve) => setTimeout(resolve, milliseconds)));
    this.now = options.now ?? (() => new Date());
  }

  async reserve(input: ReserveOperationInput): Promise<SettlementOperation> {
    this.validatePayment(input.payment);
    assertPositiveAtomicAmount(input.payment.amountAtomic);

    const existing = await this.options.store.get(input.task.operationId);
    if (existing) {
      this.assertSameReservation(existing, input);
      return existing;
    }

    const timestamp = this.now().toISOString();
    return this.options.store.create({
      operationId: input.task.operationId,
      lucidTaskId: input.task.lucidTaskId,
      lucidRunId: input.task.lucidRunId,
      entrypoint: input.task.entrypoint,
      deadlineAt: input.task.deadlineAt,
      state: "verifying",
      payment: {
        ...input.payment,
        payerAddress: normalizeAddress(input.payment.payerAddress),
        settlementAddress: normalizeAddress(input.payment.settlementAddress),
        assetAddress: normalizeAddress(input.payment.assetAddress),
        paymentTransactionHash: normalizeTransactionHash(
          input.payment.paymentTransactionHash,
        ),
      },
      workerAddress: normalizeAddress(input.workerAddress),
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  }

  async settle(task: LucidTaskEvidence): Promise<SettlementOperation> {
    let operation = await this.requireOperation(task.operationId);
    this.assertTaskIdentity(operation, task);

    if (isFinalState(operation.state)) return operation;

    const verification = operation.verification ?? (this.options.verifier ?? verifyLucidTask)(task, this.now());
    const direction = directionForOutcome(verification.outcome);
    const idempotencyKey = settlementIdempotencyKey(
      operation.operationId,
      direction,
    );

    const claim = await this.options.store.claimTerminalDecision(
      operation.operationId,
      verification,
      direction,
      idempotencyKey,
    );
    operation = claim.operation;

    const recipientAddress =
      direction === "refund"
        ? operation.payment.payerAddress
        : operation.workerAddress;

    if (direction === "refund") {
      assertPayerOwnsRefundDestination(
        operation.payment.payerAddress,
        recipientAddress,
      );
    }

    const request: SettlementRequest = {
      operationId: operation.operationId,
      direction,
      chainId: BASE_SEPOLIA_CHAIN_ID,
      tokenAddress: operation.payment.assetAddress,
      recipientAddress,
      amountAtomic: operation.payment.amountAtomic,
      idempotencyKey,
      lucidTaskId: operation.lucidTaskId,
      reasonCode: verification.reasonCode,
    };

    if (operation.execution?.status === "pending") {
      return this.pollExecution(operation.operationId, operation.execution.keeperhubExecutionId);
    }

    const decisionAt = operation.verification
      ? Date.parse(operation.verification.verifiedAt)
      : Number.NaN;
    if (
      !operation.execution &&
      Number.isFinite(decisionAt) &&
      this.now().getTime() - decisionAt >= KEEPERHUB_IDEMPOTENCY_WINDOW_MS
    ) {
      return this.options.store.recordSimulation(operation.operationId, {
        success: false,
        wouldRevert: false,
        reason: "IDEMPOTENCY_REPLAY_WINDOW_EXPIRED",
        observedAt: this.now().toISOString(),
      });
    }

    let simulation = await this.options.executor.simulate(request);
    if (simulation.success && !simulation.wouldRevert) {
      const expectedSender = normalizeAddress(operation.payment.settlementAddress);
      let simulatedSender: `0x${string}` | undefined;
      try {
        simulatedSender = simulation.fromAddress
          ? normalizeAddress(simulation.fromAddress)
          : undefined;
      } catch {
        // Invalid simulation metadata cannot prove custody.
      }
      if (!simulatedSender || simulatedSender !== expectedSender) {
        simulation = {
          ...simulation,
          success: false,
          reason: simulatedSender
            ? "KEEPERHUB_SENDER_MISMATCH"
            : "KEEPERHUB_SENDER_UNVERIFIED",
        };
      }
    }
    operation = await this.options.store.recordSimulation(
      operation.operationId,
      simulation,
    );
    if (!simulation.success || simulation.wouldRevert) return operation;

    const execution = await this.options.executor.execute(request);
    operation = await this.options.store.recordExecution(
      operation.operationId,
      execution,
    );

    if (execution.status !== "pending") return operation;
    return this.pollExecution(operation.operationId, execution.keeperhubExecutionId);
  }

  private async pollExecution(
    operationId: string,
    executionId: string,
  ): Promise<SettlementOperation> {
    let operation = await this.requireOperation(operationId);
    for (let attempt = 0; attempt < this.maxPollAttempts; attempt += 1) {
      if (attempt > 0) await this.sleep(this.pollIntervalMs);
      const execution = await this.options.executor.getExecution(executionId);
      operation = await this.options.store.recordExecution(
        operationId,
        execution,
      );
      if (execution.status !== "pending") return operation;
    }
    return operation;
  }

  private validatePayment(payment: PaymentEvidence): void {
    if (payment.network !== `eip155:${BASE_SEPOLIA_CHAIN_ID}`) {
      throw new Error("Only Base Sepolia x402 payments are accepted in this release");
    }
    if (
      normalizeAddress(payment.settlementAddress) !==
      normalizeAddress(this.options.settlementAddress)
    ) {
      throw new Error("x402 payTo does not match the KeeperHub settlement wallet");
    }
    if (
      normalizeAddress(payment.assetAddress) !==
      normalizeAddress(this.options.usdcAddress)
    ) {
      throw new Error("Payment asset is not the pinned Base Sepolia USDC token");
    }
  }

  private assertTaskIdentity(
    operation: SettlementOperation,
    task: LucidTaskEvidence,
  ): void {
    if (
      operation.lucidTaskId !== task.lucidTaskId ||
      operation.lucidRunId !== task.lucidRunId ||
      operation.entrypoint !== task.entrypoint
    ) {
      throw new Error("Lucid task identity does not match its reservation");
    }
  }

  private assertSameReservation(
    operation: SettlementOperation,
    input: ReserveOperationInput,
  ): void {
    this.assertTaskIdentity(operation, {
      ...input.task,
      status: "running",
      deadlineAt: input.task.reservedAt,
    });
    if (
      operation.payment.paymentTransactionHash !==
        normalizeTransactionHash(input.payment.paymentTransactionHash) ||
      operation.payment.payerAddress !== normalizeAddress(input.payment.payerAddress) ||
      operation.workerAddress !== normalizeAddress(input.workerAddress)
    ) {
      throw new Error("operationId was already reserved with different payment data");
    }
  }

  private async requireOperation(operationId: string): Promise<SettlementOperation> {
    const operation = await this.options.store.get(operationId);
    if (!operation) throw new Error(`Unknown operation: ${operationId}`);
    return operation;
  }
}
