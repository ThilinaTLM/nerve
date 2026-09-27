import type { DatabaseSync } from "node:sqlite";

export interface StorageVerificationIssue {
  check: "quick_check" | "foreign_key_check" | "step" | "sweep";
  detail: string;
}

export function verifyStorageDatabase(
  database: DatabaseSync,
): StorageVerificationIssue[] {
  const issues: StorageVerificationIssue[] = [];
  const quick = database
    .prepare("PRAGMA quick_check")
    .all() as unknown as Array<{
    quick_check: string;
  }>;
  for (const row of quick) {
    if (row.quick_check !== "ok") {
      issues.push({ check: "quick_check", detail: row.quick_check });
    }
  }
  const foreignKeys = database
    .prepare("PRAGMA foreign_key_check")
    .all() as unknown as Array<{
    table: string;
    rowid: number | null;
    parent: string;
    fkid: number;
  }>;
  for (const row of foreignKeys) {
    issues.push({
      check: "foreign_key_check",
      detail: `${row.table}:${row.rowid ?? "unknown"} -> ${row.parent} (${row.fkid})`,
    });
  }
  return issues;
}

export function assertStorageDatabaseValid(database: DatabaseSync): void {
  const issues = verifyStorageDatabase(database);
  if (issues.length > 0) {
    throw new Error(
      `Storage verification failed: ${issues
        .map((issue) => `${issue.check}: ${issue.detail}`)
        .join("; ")}`,
    );
  }
}
