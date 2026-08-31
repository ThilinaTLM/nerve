import { DatabaseSync } from "node:sqlite";
import { CANONICAL_SCHEMA_VERSION } from "./schema.js";

export type CanonicalSchemaInspection =
  | { kind: "uninitialized" }
  | { kind: "current"; version: number }
  | { kind: "migration-required"; version: number }
  | { kind: "unsupported-newer"; version: number };

/** Reads only the migration ledger head; no migration body is loaded or run. */
export function inspectCanonicalSchema(
  path: string,
): CanonicalSchemaInspection {
  const database = new DatabaseSync(path, { readOnly: true });
  try {
    const hasLedger = database
      .prepare(
        `SELECT 1 AS present FROM sqlite_master
         WHERE type = 'table' AND name = 'schema_migrations'`,
      )
      .get() as { present?: number } | undefined;
    if (hasLedger?.present !== 1) return { kind: "uninitialized" };
    const latest = database
      .prepare(
        `SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1`,
      )
      .get() as { version: number } | undefined;
    if (!latest) return { kind: "uninitialized" };
    if (latest.version > CANONICAL_SCHEMA_VERSION) {
      return { kind: "unsupported-newer", version: latest.version };
    }
    return latest.version === CANONICAL_SCHEMA_VERSION
      ? { kind: "current", version: latest.version }
      : { kind: "migration-required", version: latest.version };
  } finally {
    database.close();
  }
}
