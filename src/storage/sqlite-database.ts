import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

export class SqliteDatabase {
  readonly connection: DatabaseSync;

  constructor(path: string) {
    const directory = dirname(path);
    if (directory && directory !== ".") mkdirSync(directory, { recursive: true });
    this.connection = new DatabaseSync(path);
    this.connection.exec("PRAGMA busy_timeout = 5000");
    this.connection.exec("PRAGMA journal_mode = WAL");
    this.connection.exec("PRAGMA foreign_keys = ON");
  }

  transaction<T>(work: () => T): T {
    this.connection.exec("BEGIN IMMEDIATE");
    try {
      const result = work();
      this.connection.exec("COMMIT");
      return result;
    } catch (error) {
      try {
        this.connection.exec("ROLLBACK");
      } catch {
        // Keep the original failure.
      }
      throw error;
    }
  }

  close(): void {
    this.connection.close();
  }
}
