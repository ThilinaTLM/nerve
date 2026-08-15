import { existsSync, rmSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

export function withMigrationDatabase<T>(
  path: string,
  operation: (database: DatabaseSync) => T,
): T {
  const database = new DatabaseSync(path);
  try {
    database.exec("PRAGMA journal_mode = WAL");
    database.exec("PRAGMA synchronous = FULL");
    return operation(database);
  } finally {
    database.close();
  }
}

export function transaction<T>(database: DatabaseSync, operation: () => T): T {
  database.exec("BEGIN IMMEDIATE");
  try {
    const result = operation();
    database.exec("COMMIT");
    return result;
  } catch (error) {
    try {
      database.exec("ROLLBACK");
    } catch {
      // Preserve the original migration failure.
    }
    throw error;
  }
}

export function tableNames(database: DatabaseSync): Set<string> {
  const rows = database
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
    .all() as Array<{ name: string }>;
  return new Set(rows.map((row) => row.name));
}

export function invalidateDerivedDatabase(path: string): void {
  for (const suffix of ["", "-wal", "-shm"]) {
    const candidate = `${path}${suffix}`;
    if (existsSync(candidate)) rmSync(candidate, { force: true });
  }
}
