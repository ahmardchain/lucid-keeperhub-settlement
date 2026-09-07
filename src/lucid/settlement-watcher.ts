import type { Task } from "@lucid-agents/types/a2a";
import { SettlementCoordinator } from "../settlement/coordinator";
import type {
  LucidTaskEvidence,
  SettlementOperation,
} from "../settlement/types";
import { isFinalState } from "../settlement/state-machine";
import { SqliteSettlementStore } from "../settlement/sqlite-store";
import { SqliteTaskStore } from "./sqlite-task-store";

interface SettlementWatcherOptions {
  coordinator: SettlementCoordinator;
  settlementStore: SqliteSettlementStore;
  taskStore: SqliteTaskStore;
  pollIntervalMs?: number;
  now?: () => Date;
  onSettled?: (operation: SettlementOperation) => Promise<void> | void;
}

export class SettlementWatcher {
  private readonly active = new Set<string>();
  private readonly pollIntervalMs: number;
  private readonly now: () => Date;
  private stopped = false;

  constructor(private readonly options: SettlementWatcherOptions) {
    this.pollIntervalMs = options.pollIntervalMs ?? 500;
    this.now = options.now ?? (() => new Date());
  }

  async recover(): Promise<number> {
    const operations = await this.options.settlementStore.listRecoverable();
    for (const operation of operations) this.watch(operation.operationId);
    return operations.length;
  }

  watch(operationId: string): void {
    if (this.stopped || this.active.has(operationId)) return;
    this.active.add(operationId);
    void this.monitor(operationId)
      .catch((error) => {
        console.error(
          `[settlement:watcher] ${operationId} requires recovery`,
          error,
        );
      })
      .finally(() => this.active.delete(operationId));
  }

  close(): void {
    this.stopped = true;
  }

  private async monitor(operationId: string): Promise<void> {
    const operation = await this.options.settlementStore.get(operationId);
    if (!operation) throw new Error(`Unknown settlement operation: ${operationId}`);

    while (!this.stopped) {
      const stored = await this.options.taskStore.getDirect(operation.lucidTaskId);
      const now = this.now();
      if (stored && stored.task.status !== "running") {
        const settled = await this.options.coordinator.settle(
          this.toEvidence(operation, stored.task),
        );
        if (isFinalState(settled.state)) {
          await this.options.onSettled?.(settled);
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, this.pollIntervalMs));
        continue;
      }
      if (now.getTime() > Date.parse(operation.deadlineAt)) {
        const settled = await this.options.coordinator.settle(
          this.toEvidence(
            operation,
            stored?.task ?? {
              taskId: operation.lucidTaskId,
              status: "running",
              createdAt: operation.createdAt,
              updatedAt: now.toISOString(),
            },
          ),
        );
        if (isFinalState(settled.state)) {
          await this.options.onSettled?.(settled);
          return;
        }
      }
      await new Promise((resolve) => setTimeout(resolve, this.pollIntervalMs));
    }
  }

  private toEvidence(
    operation: SettlementOperation,
    task: Task<unknown>,
  ): LucidTaskEvidence {
    return {
      operationId: operation.operationId,
      lucidTaskId: task.taskId,
      lucidRunId: operation.lucidRunId,
      entrypoint: operation.entrypoint,
      status: task.status,
      reservedAt: operation.createdAt,
      deadlineAt: operation.deadlineAt,
      completedAt: task.status === "running" ? undefined : task.updatedAt,
      output: task.result?.output,
      failureCode: task.error?.code,
    };
  }
}
