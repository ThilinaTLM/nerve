import { DatabaseSync } from "node:sqlite";

export function hasFrameworkStorageMigration(
  sqlitePath: string,
  migrationId: string,
): boolean {
  const database = new DatabaseSync(sqlitePath, { readOnly: true });
  try {
    const table = database
      .prepare(
        `SELECT 1 AS present FROM sqlite_master
         WHERE type = 'table' AND name = 'storage_migrations'`,
      )
      .get() as { present?: number } | undefined;
    if (table?.present !== 1) return false;
    return Boolean(
      database
        .prepare("SELECT 1 FROM storage_migrations WHERE id = ?")
        .get(migrationId),
    );
  } finally {
    database.close();
  }
}
