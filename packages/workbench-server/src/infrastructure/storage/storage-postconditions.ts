import { settingsSchema } from "@nervekit/contracts";
import { join } from "node:path";
import { readLedger, validateLedger } from "../migrations/ledger.js";
import { storageMigrationRegistry } from "../migrations/registry.js";
import { withMigrationDatabase } from "../migrations/sqlite.js";
import { decode } from "../canonical-store/payload-codecs.js";
import { pathExists, readJsonFile } from "./json.js";
import type { StoragePaths } from "./paths.js";

export async function assertCurrentStorage(paths: StoragePaths): Promise<void> {
  if (await pathExists(paths.sqlitePath)) {
    const canonical = withMigrationDatabase(paths.sqlitePath, (database) => {
      const table = database
        .prepare(
          `SELECT 1 AS present FROM sqlite_master
           WHERE type = 'table' AND name = 'schema_migrations'`,
        )
        .get();
      if (!table) return false;
      const settings = database
        .prepare(`SELECT data FROM settings_store WHERE id = 'settings'`)
        .get() as { data?: Uint8Array | string } | undefined;
      if (!settings?.data)
        throw new Error("Canonical settings are missing after migrations.");
      settingsSchema.parse(decode(settings.data));
      const foreignKeys = database.prepare("PRAGMA foreign_key_check").all();
      if (foreignKeys.length > 0)
        throw new Error("SQLite foreign_key_check failed after migrations.");
      const result = database.prepare("PRAGMA quick_check").get() as
        | { quick_check?: unknown }
        | undefined;
      if (result?.quick_check !== "ok")
        throw new Error("SQLite quick_check failed after migrations.");
      return true;
    });
    if (canonical) return;
  }

  const raw = await readJsonFile<unknown>(paths.configPath);
  const parsed = settingsSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .slice(0, 8)
      .map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`)
      .join("; ");
    throw new Error(`Settings are invalid after migrations: ${issues}`);
  }
  const changed = normalizedJsonPaths(raw, parsed.data);
  if (changed.length > 0) {
    throw new Error(
      `Settings remain non-canonical after migrations at: ${changed.slice(0, 12).join(", ")}`,
    );
  }

  const ledger = await readLedger(paths.migrationLedgerPath);
  validateLedger(ledger, storageMigrationRegistry);
  if (ledger.applied.length !== storageMigrationRegistry.length) {
    throw new Error(
      `Storage migration ledger is incomplete (${ledger.applied.length}/${storageMigrationRegistry.length}).`,
    );
  }
  if (await pathExists(join(paths.migrationsPath, "active-batch.json"))) {
    throw new Error("Storage migration rollback batch remains active.");
  }
  if (!(await pathExists(paths.sqlitePath))) {
    throw new Error("Required SQLite storage is missing after migrations.");
  }
  const result = withMigrationDatabase(
    paths.sqlitePath,
    (database) =>
      database.prepare("PRAGMA quick_check").get() as
        | { quick_check?: unknown }
        | undefined,
  );
  if (result?.quick_check !== "ok") {
    throw new Error("SQLite quick_check failed after migrations.");
  }
}

export function normalizedJsonPaths(left: unknown, right: unknown): string[] {
  const changed: string[] = [];
  compareJson(left, right, "", changed);
  return changed;
}

function compareJson(
  left: unknown,
  right: unknown,
  path: string,
  changed: string[],
): void {
  if (JSON.stringify(left) === JSON.stringify(right)) return;
  if (!isRecord(left) || !isRecord(right)) {
    changed.push(path || "<root>");
    return;
  }
  for (const key of new Set([...Object.keys(left), ...Object.keys(right)])) {
    compareJson(left[key], right[key], path ? `${path}.${key}` : key, changed);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
