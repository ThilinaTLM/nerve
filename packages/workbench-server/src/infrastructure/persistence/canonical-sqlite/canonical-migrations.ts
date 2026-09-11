import { DatabaseSync } from "node:sqlite";
import { assertCanonicalSchemaPrefixCompatible } from "./canonical-database-helpers.js";
import { CANONICAL_MIGRATIONS } from "./schema.js";

export function applyCanonicalMigrations(database: DatabaseSync): void {
  const rows = () =>
    database
      .prepare(
        "SELECT version, checksum FROM schema_migrations ORDER BY version",
      )
      .all() as unknown as Array<{ version: number; checksum: string }>;
  assertCanonicalSchemaPrefixCompatible(rows());
  for (const migration of CANONICAL_MIGRATIONS) {
    const currentVersion = rows().at(-1)?.version ?? 0;
    if (migration.version <= currentVersion) continue;
    if (migration.version !== currentVersion + 1) {
      throw new Error(
        `Storage migration sequence is incomplete at version ${migration.version}.`,
      );
    }
    const startedAt = Date.now();
    database.exec("BEGIN IMMEDIATE");
    try {
      database.exec(migration.sql);
      database
        .prepare(
          `INSERT INTO schema_migrations (
             version, name, checksum, applied_at_ms, duration_ms
           ) VALUES (?, ?, ?, ?, ?)`,
        )
        .run(
          migration.version,
          migration.name,
          migration.checksum,
          Date.now(),
          Date.now() - startedAt,
        );
      database.exec("COMMIT");
    } catch (error) {
      try {
        database.exec("ROLLBACK");
      } catch {
        // Preserve the migration error.
      }
      throw error;
    }
  }
}
