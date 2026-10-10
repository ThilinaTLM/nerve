import { DatabaseSync } from "node:sqlite";

export interface CoreDatabase {
  readonly sqlite: DatabaseSync;
  transaction<T>(fn: () => T): T;
  close(): void;
}

export function openCoreDatabase(path: string): CoreDatabase {
  const sqlite = new DatabaseSync(path);
  try {
    sqlite.exec(
      "PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;",
    );
  } catch (error) {
    sqlite.close();
    throw error;
  }
  let inTransaction = false;
  return {
    sqlite,
    transaction<T>(fn: () => T): T {
      if (inTransaction) return fn();
      sqlite.exec("BEGIN IMMEDIATE");
      inTransaction = true;
      try {
        const result = fn();
        if (result instanceof Promise)
          throw new Error("Core transactions must be synchronous");
        sqlite.exec("COMMIT");
        return result;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      } finally {
        inTransaction = false;
      }
    },
    close() {
      sqlite.close();
    },
  };
}
