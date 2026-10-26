import { createHash } from "node:crypto";
import type { CoreDatabase } from "./database.js";
import { coreSchemaV1 } from "./schema.js";
import { coreSchemaV2, applyCoreSchemaV2 } from "./schema-v2.js";

export const coreMigrations = [
  { version: 1, name: "conversation core foundation", sql: coreSchemaV1 },
  { version: 2, name: "agent profiles", sql: coreSchemaV2 },
] as const;

export function migrate(db: CoreDatabase): void {
  // foreign_keys cannot be changed inside a transaction. Refuse nested migration
  // instead of silently rebuilding with enforcement still enabled.
  if (db.sqlite.isTransaction)
    throw new Error("Core migrations require their own transaction");
  const foreignKeys = db.sqlite
    .prepare("PRAGMA foreign_keys")
    .get()?.foreign_keys;
  db.sqlite.exec("PRAGMA foreign_keys=OFF");
  try {
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
      let changed = false;
      for (const step of coreMigrations) {
        if (applied.some((row) => row.version === step.version)) continue;
        changed = true;
        if (step.version === 2) applyCoreSchemaV2(db);
        else db.sqlite.exec(step.sql);
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
      if (changed && db.sqlite.prepare("PRAGMA foreign_key_check").all().length)
        throw new Error("Core migration foreign key check failed");
    });
  } finally {
    db.sqlite.exec(`PRAGMA foreign_keys=${foreignKeys ? "ON" : "OFF"}`);
  }
}

function checksum(sql: string): string {
  return createHash("sha256").update(sql).digest("hex");
}
