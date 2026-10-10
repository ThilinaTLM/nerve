import { createHash } from "node:crypto";
import type { CoreDatabase } from "./database.js";
import { coreSchemaV1 } from "./schema.js";

export const coreMigrations = [
  { version: 1, name: "conversation core foundation", sql: coreSchemaV1 },
] as const;

export function migrate(db: CoreDatabase): void {
  db.transaction(() => {
    db.sqlite.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY, name TEXT NOT NULL, checksum TEXT NOT NULL, applied_at TEXT NOT NULL
    ) STRICT`);
    const applied = db.sqlite
      .prepare(
        "SELECT version, checksum FROM schema_migrations ORDER BY version",
      )
      .all();
    for (const row of applied) {
      const step = coreMigrations.find(
        (migration) => migration.version === row.version,
      );
      if (!step)
        throw new Error(`Unsupported core schema version: ${row.version}`);
      if (row.checksum !== checksum(step.sql))
        throw new Error(`Core migration checksum mismatch: ${row.version}`);
    }
    for (const step of coreMigrations) {
      if (applied.some((row) => row.version === step.version)) continue;
      db.sqlite.exec(step.sql);
      db.sqlite
        .prepare(
          "INSERT INTO schema_migrations(version, name, checksum, applied_at) VALUES (?, ?, ?, ?)",
        )
        .run(
          step.version,
          step.name,
          checksum(step.sql),
          new Date().toISOString(),
        );
    }
  });
}

function checksum(sql: string): string {
  return createHash("sha256").update(sql).digest("hex");
}
