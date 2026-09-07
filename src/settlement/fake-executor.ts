import type {
  ExecutionEvidence,
  KeeperHubExecutor,
  SettlementRequest,
  SimulationEvidence,
} from "./types";

export interface FakeKeeperHubOptions {
  simulation?: "success" | "revert" | "error";
  simulatedFromAddress?: `0x${string}`;
  finalStatus?: "completed" | "failed";
  pendingPolls?: number;
}

export class FakeKeeperHubExecutor implements KeeperHubExecutor {
  readonly simulationRequests: SettlementRequest[] = [];
  readonly executionRequests: SettlementRequest[] = [];
  readonly statusRequests: string[] = [];
  private remainingPendingPolls: number;

  constructor(private readonly options: FakeKeeperHubOptions = {}) {
    this.remainingPendingPolls = options.pendingPolls ?? 0;
  }

  async simulate(request: SettlementRequest): Promise<SimulationEvidence> {
    this.simulationRequests.push(structuredClone(request));
    const mode = this.options.simulation ?? "success";
    return {
      success: mode !== "error",
      wouldRevert: mode === "revert",
      estimatedGasUnits: mode === "success" ? "65124" : undefined,
      fromAddress: this.options.simulatedFromAddress,
      reason: mode === "success" ? undefined : `fake_${mode}`,
      observedAt: "2026-09-07T12:01:00.000Z",
    };
  }

  async execute(request: SettlementRequest): Promise<ExecutionEvidence> {
    this.executionRequests.push(structuredClone(request));
    return {
      keeperhubExecutionId: `kh_${request.operationId}`,
      status: "pending",
      observedAt: "2026-09-07T12:01:01.000Z",
    };
  }

  async getExecution(executionId: string): Promise<ExecutionEvidence> {
    this.statusRequests.push(executionId);
    if (this.remainingPendingPolls > 0) {
      this.remainingPendingPolls -= 1;
      return {
        keeperhubExecutionId: executionId,
        status: "pending",
        observedAt: "2026-09-07T12:01:02.000Z",
      };
    }

    const finalStatus = this.options.finalStatus ?? "completed";
    return {
      keeperhubExecutionId: executionId,
      status: finalStatus,
      transactionHash:
        finalStatus === "completed"
          ? (`0x${"ab".repeat(32)}` as `0x${string}`)
          : undefined,
      error: finalStatus === "failed" ? "fake_execution_failure" : undefined,
      observedAt: "2026-09-07T12:01:03.000Z",
    };
  }
}
