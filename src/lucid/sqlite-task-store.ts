import { paymentContext } from "./payment-journal";
import { TaskCapacityError } from "@lucid-agents/a2a";
import type {
  ListTasksRequest,
  ListTasksResponse,
  StoredTask,
  Task,
  TaskStatus,
  TaskStore,
  TaskUpdateEvent,
} from "@lucid-agents/types/a2a";
import { SqliteDatabase } from "../storage/sqlite-database";

interface SqliteTaskStoreOptions {
  databasePath: string;
  maxTasks?: number;
  retentionMs?: number;
  now?: () => number;
}

interface TaskRow {
  task_id: string;
  owner_hash: string;
  task_json: string;
  admission_expires_at: number | null;
  lease_owner_id: string | null;
  lease_expires_at: number | null;
  lease_phase: "prepared" | "active" | null;
}

const TERMINAL = new Set<TaskStatus>(["completed", "failed", "cancelled"]);

function rowToRecord(row: TaskRow): StoredTask {
  return {
    task: JSON.parse(row.task_json) as Task,
    ownerHash: row.owner_hash,
    ...(row.admission_expires_at === null
      ? {}
      : { admissionExpiresAt: row.admission_expires_at }),
    ...(row.lease_owner_id && row.lease_expires_at !== null && row.lease_phase
      ? {
          executionLease: {
            ownerId: row.lease_owner_id,
            expiresAt: row.lease_expires_at,
            phase: row.lease_phase,
          },
        }
      : {}),
  };
}

export class SqliteTaskStore implements TaskStore {
  readonly durability = "durable" as const;
  private readonly database: SqliteDatabase;
  private readonly maxTasks: number;
  private readonly retentionMs: number;
  private readonly now: () => number;
  private readonly listeners = new Map<
    string,
    Set<(event: TaskUpdateEvent) => void | Promise<void>>
  >();

  constructor(options: SqliteTaskStoreOptions) {
    this.maxTasks = options.maxTasks ?? 1_000;
    this.retentionMs = options.retentionMs ?? 24 * 60 * 60 * 1_000;
    this.now = options.now ?? Date.now;
    this.database = new SqliteDatabase(options.databasePath);
    this.database.connection.exec(`
      CREATE TABLE IF NOT EXISTS lucid_tasks (
        task_id TEXT PRIMARY KEY,
        owner_hash TEXT NOT NULL,
        task_json TEXT NOT NULL,
        admission_expires_at INTEGER,
        lease_owner_id TEXT,
        lease_expires_at INTEGER,
        lease_phase TEXT CHECK (lease_phase IN ('prepared', 'active')),
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_lucid_tasks_owner
        ON lucid_tasks(owner_hash, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_lucid_tasks_admission
        ON lucid_tasks(admission_expires_at);
      CREATE INDEX IF NOT EXISTS idx_lucid_tasks_lease
        ON lucid_tasks(lease_expires_at, lease_phase);
    `);
  }

  async reapExpiredAdmissions(at: number): Promise<number> {
    const rows = this.database.connection
      .prepare(
        `SELECT * FROM lucid_tasks
         WHERE (admission_expires_at IS NOT NULL
                AND admission_expires_at <= ?
                AND lease_owner_id IS NULL)
            OR (lease_phase = 'prepared' AND lease_expires_at <= ?)`,
      )
      .all(at, at) as unknown as TaskRow[];

    if (rows.length === 0) return 0;
    this.database.transaction(() => {
      const update = this.database.connection.prepare(
        `UPDATE lucid_tasks
         SET task_json = ?, admission_expires_at = NULL,
             lease_owner_id = NULL, lease_expires_at = NULL,
             lease_phase = NULL, updated_at = ?
         WHERE task_id = ?`,
      );
      for (const row of rows) {
        const record = rowToRecord(row);
        const task: Task = {
          ...record.task,
          status: "cancelled",
          updatedAt: new Date(at).toISOString(),
        };
        update.run(JSON.stringify(task), at, task.taskId);
      }
    });
    for (const row of rows) {
      this.publish(row.task_id, {
        type: "statusUpdate",
        data: { taskId: row.task_id, status: "cancelled" },
      });
    }
    return rows.length;
  }

  async create(record: StoredTask, event: TaskUpdateEvent): Promise<void> {
    await this.reapExpiredAdmissions(this.now());
    this.purgeExpiredTerminal();
    this.database.transaction(() => {
      const existing = this.readRow(record.task.taskId);
      if (existing) throw new Error(`Task "${record.task.taskId}" already exists`);

      let count = Number(
        (
          this.database.connection
            .prepare("SELECT COUNT(*) AS count FROM lucid_tasks")
            .get() as { count: number }
        ).count,
      );
      while (count >= this.maxTasks) {
        const terminal = this.allRows()
          .map(rowToRecord)
          .filter((candidate) => TERMINAL.has(candidate.task.status))
          .sort(
            (left, right) =>
              Date.parse(left.task.updatedAt) - Date.parse(right.task.updatedAt),
          )[0];
        if (!terminal) throw new TaskCapacityError(this.maxTasks);
        this.database.connection
          .prepare("DELETE FROM lucid_tasks WHERE task_id = ?")
          .run(terminal.task.taskId);
        count -= 1;
      }

      this.database.connection
        .prepare(
          `INSERT INTO lucid_tasks (
             task_id, owner_hash, task_json, admission_expires_at,
             lease_owner_id, lease_expires_at, lease_phase, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          record.task.taskId,
          record.ownerHash,
          JSON.stringify(record.task),
          record.admissionExpiresAt ?? null,
          record.executionLease?.ownerId ?? null,
          record.executionLease?.expiresAt ?? null,
          record.executionLease?.phase ?? null,
          Date.parse(record.task.updatedAt),
        );
    });
    const capture = paymentContext.getStore();
    capture?.journal.update(capture.operationId, { taskId: record.task.taskId });
    this.publish(record.task.taskId, event);
  }

  async get(taskId: string): Promise<StoredTask | undefined> {
    this.purgeExpiredTerminal();
    const row = this.readRow(taskId);
    return row ? rowToRecord(row) : undefined;
  }

  async getDirect(taskId: string): Promise<StoredTask | undefined> {
    return this.get(taskId);
  }

  async list(
    ownerHash: string,
    filters: ListTasksRequest = {},
  ): Promise<ListTasksResponse> {
    this.purgeExpiredTerminal();
    const statuses = filters.status
      ? Array.isArray(filters.status)
        ? filters.status
        : [filters.status]
      : undefined;
    const offset = Math.max(0, filters.offset ?? 0);
    const limit = Math.max(0, Math.min(filters.limit ?? 50, 1_000));
    const tasks = this.database.connection
      .prepare(
        "SELECT * FROM lucid_tasks WHERE owner_hash = ? ORDER BY updated_at DESC",
      )
      .all(ownerHash) as unknown as TaskRow[];
    const filtered = tasks
      .map((row) => rowToRecord(row).task)
      .filter((task) => !filters.contextId || task.contextId === filters.contextId)
      .filter((task) => !statuses || statuses.includes(task.status));
    return {
      tasks: filtered.slice(offset, offset + limit),
      total: filtered.length,
      hasMore: offset + limit < filtered.length,
    };
  }

  async claimExecution(
    taskId: string,
    ownerId: string,
    expiresAt: number,
    claimedAt: number,
  ): Promise<Task | undefined> {
    await this.reapExpiredAdmissions(claimedAt);
    return this.database.transaction(() => {
      const row = this.readRow(taskId);
      if (!row) return undefined;
      const record = rowToRecord(row);
      if (record.task.status !== "running") return undefined;
      if (
        record.executionLease &&
        record.executionLease.expiresAt > claimedAt
      ) {
        return undefined;
      }
      this.database.connection
        .prepare(
          `UPDATE lucid_tasks
           SET admission_expires_at = NULL, lease_owner_id = ?,
               lease_expires_at = ?, lease_phase = 'prepared', updated_at = ?
           WHERE task_id = ?`,
        )
        .run(ownerId, expiresAt, claimedAt, taskId);
      return record.task;
    });
  }

  async renewExecutionClaim(
    taskId: string,
    ownerId: string,
    expiresAt: number,
    claimedAt: number,
  ): Promise<Task | undefined> {
    return this.database.transaction(() => {
      const row = this.readRow(taskId);
      if (!row) return undefined;
      const record = rowToRecord(row);
      if (
        record.task.status !== "running" ||
        record.executionLease?.phase !== "prepared" ||
        record.executionLease.ownerId !== ownerId ||
        record.executionLease.expiresAt <= claimedAt
      ) {
        return undefined;
      }
      this.database.connection
        .prepare(
          `UPDATE lucid_tasks SET lease_expires_at = ?, updated_at = ?
           WHERE task_id = ?`,
        )
        .run(expiresAt, claimedAt, taskId);
      return record.task;
    });
  }

  async activateExecution(
    taskId: string,
    ownerId: string,
    expiresAt: number,
    activatedAt: number,
  ): Promise<Task | undefined> {
    return this.database.transaction(() => {
      const row = this.readRow(taskId);
      if (!row) return undefined;
      const record = rowToRecord(row);
      if (
        record.task.status !== "running" ||
        record.executionLease?.phase !== "prepared" ||
        record.executionLease.ownerId !== ownerId ||
        record.executionLease.expiresAt <= activatedAt
      ) {
        return undefined;
      }
      this.database.connection
        .prepare(
          `UPDATE lucid_tasks
           SET admission_expires_at = NULL, lease_expires_at = ?,
               lease_phase = 'active', updated_at = ?
           WHERE task_id = ?`,
        )
        .run(expiresAt, activatedAt, taskId);
      return record.task;
    });
  }

  async compareAndSet(
    taskId: string,
    expected: TaskStatus[],
    next: Task,
    event: TaskUpdateEvent,
    executionOwnerId?: string,
  ): Promise<Task | undefined> {
    const changed = this.database.transaction(() => {
      const row = this.readRow(taskId);
      if (!row) return false;
      const record = rowToRecord(row);
      if (!expected.includes(record.task.status)) return false;
      if (
        executionOwnerId &&
        record.executionLease?.ownerId !== executionOwnerId
      ) {
        return false;
      }
      const terminal = TERMINAL.has(next.status);
      this.database.connection
        .prepare(
          `UPDATE lucid_tasks
           SET task_json = ?, admission_expires_at = ?, lease_owner_id = ?,
               lease_expires_at = ?, lease_phase = ?, updated_at = ?
           WHERE task_id = ?`,
        )
        .run(
          JSON.stringify(next),
          terminal ? null : record.admissionExpiresAt ?? null,
          terminal ? null : record.executionLease?.ownerId ?? null,
          terminal ? null : record.executionLease?.expiresAt ?? null,
          terminal ? null : record.executionLease?.phase ?? null,
          Date.parse(next.updatedAt),
          taskId,
        );
      return true;
    });
    if (!changed) return undefined;
    this.publish(taskId, event);
    return next;
  }

  async subscribe(
    taskId: string,
    ownerHash: string,
    listener: (event: TaskUpdateEvent) => void | Promise<void>,
  ): Promise<() => void> {
    if (this.readRow(taskId)?.owner_hash !== ownerHash) return () => undefined;
    const taskListeners = this.listeners.get(taskId) ?? new Set();
    taskListeners.add(listener);
    this.listeners.set(taskId, taskListeners);
    return () => {
      taskListeners.delete(listener);
      if (taskListeners.size === 0) this.listeners.delete(taskId);
    };
  }

  close(): void {
    this.listeners.clear();
    this.database.close();
  }

  private readRow(taskId: string): TaskRow | undefined {
    return this.database.connection
      .prepare("SELECT * FROM lucid_tasks WHERE task_id = ?")
      .get(taskId) as unknown as TaskRow | undefined;
  }

  private allRows(): TaskRow[] {
    return this.database.connection
      .prepare("SELECT * FROM lucid_tasks")
      .all() as unknown as TaskRow[];
  }

  private purgeExpiredTerminal(): void {
    const cutoff = this.now() - this.retentionMs;
    const expiredIds = this.allRows()
      .map(rowToRecord)
      .filter(
        (record) =>
          TERMINAL.has(record.task.status) &&
          Date.parse(record.task.updatedAt) <= cutoff,
      )
      .map((record) => record.task.taskId);
    if (expiredIds.length === 0) return;
    this.database.transaction(() => {
      const remove = this.database.connection.prepare(
        "DELETE FROM lucid_tasks WHERE task_id = ?",
      );
      for (const taskId of expiredIds) remove.run(taskId);
    });
  }

  private publish(taskId: string, event: TaskUpdateEvent): void {
    for (const listener of this.listeners.get(taskId) ?? []) {
      Promise.resolve(listener(event)).catch((error) => {
        console.error("[settlement:task-store] subscriber failed", error);
      });
    }
  }
}
