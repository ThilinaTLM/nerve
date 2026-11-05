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
        if (isPromiseLike(result)) {
          // The callback's side effects cannot be transactional; avoid an unhandled rejection too.
          void Promise.resolve(result).catch(() => undefined);
          throw new Error("Core transactions must be synchronous");
        }
        sqlite.exec("COMMIT");
        return result;
      } catch (error) {
        try {
          if (sqlite.isTransaction) sqlite.exec("ROLLBACK");
        } catch {
          // Preserve the original failure.
        }
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

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return typeof (value as PromiseLike<unknown> | null)?.then === "function";
}
