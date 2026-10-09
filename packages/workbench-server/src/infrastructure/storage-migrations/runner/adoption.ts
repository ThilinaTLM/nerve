import { readFile } from "node:fs/promises";
import type { DatabaseSync } from "node:sqlite";
import {
  CANONICAL_BASELINE_CHECKSUM,
  CANONICAL_MIGRATIONS,
} from "../../persistence/canonical-sqlite/schema.js";
import type { StoragePaths } from "../../storage-bootstrap/paths.js";
import type { RegisteredStorageMigration } from "./planner.js";

import { CANONICAL_SCHEMA_STEP_IDS } from "./canonical-schema-steps.js";

const TOOL_RESULT_MIGRATION_ID = "tool-result-payload-reference-v2";
const OBLIGATION_MARKER_ID = "agent-async-obligations-v1";

export interface LegacyAdoptionInspection {
  adoptedIds: string[];
  pendingIds: string[];
}

/** Inspect only exact legacy completion evidence; ambiguity remains pending. */
export async function inspectLegacyAdoption(
  database: DatabaseSync,
  paths: StoragePaths,
  registry: readonly RegisteredStorageMigration[],
): Promise<LegacyAdoptionInspection> {
  const adopted = new Set<string>();
  const canonicalRows = readCanonicalRows(database);
  const expectedChecksums = [
    CANONICAL_BASELINE_CHECKSUM,
    ...CANONICAL_MIGRATIONS.map((migration) => migration.checksum),
  ];
  for (const [index, row] of canonicalRows.entries()) {
    const expectedVersion = index + 1;
    if (
      row.version !== expectedVersion ||
      row.checksum !== expectedChecksums[index]
    ) {
      throw new Error(
        `Legacy schema migration v${row.version} does not match released history.`,
      );
    }
    const step = registry.find(
      (candidate) => candidate.id === CANONICAL_SCHEMA_STEP_IDS[row.version],
    );
    if (!step) {
      throw new Error(
        `Legacy schema v${row.version} is newer than this migration registry.`,
      );
    }
    adopted.add(step.id);
  }

  if (
    await legacyHomeLedgerContains(
      paths.migrationLedgerPath,
      TOOL_RESULT_MIGRATION_ID,
    )
  ) {
    addOrdinal(registry, adopted, 8);
  }
  if (hasObligationMarker(database)) addOrdinal(registry, adopted, 9);
  if (hasExactDeletionIndexes(database)) addOrdinal(registry, adopted, 10);

  return {
    adoptedIds: registry
      .filter((step) => adopted.has(step.id))
      .map((step) => step.id),
    pendingIds: registry
      .filter((step) => !adopted.has(step.id))
      .map((step) => step.id),
  };
}

function readCanonicalRows(
  database: DatabaseSync,
): Array<{ version: number; checksum: string }> {
  if (!tableExists(database, "schema_migrations")) return [];
  return database
    .prepare("SELECT version, checksum FROM schema_migrations ORDER BY version")
    .all() as unknown as Array<{ version: number; checksum: string }>;
}

async function legacyHomeLedgerContains(
  path: string,
  id: string,
): Promise<boolean> {
  try {
    const value = JSON.parse(await readFile(path, "utf8")) as {
      format?: unknown;
      version?: unknown;
      entries?: unknown;
    };
    return (
      value.format === "nerve-home-migrations" &&
      value.version === 1 &&
      Array.isArray(value.entries) &&
      value.entries.some(
        (entry) =>
          entry !== null &&
          typeof entry === "object" &&
          (entry as { id?: unknown }).id === id,
      )
    );
  } catch (error) {
    if (errorCode(error) === "ENOENT") return false;
    throw new Error("Legacy migration ledger is unreadable.", { cause: error });
  }
}

function hasObligationMarker(database: DatabaseSync): boolean {
  if (!tableExists(database, "domain_documents")) return false;
  return Boolean(
    database
      .prepare(
        `SELECT 1 FROM domain_documents
         WHERE namespace = 'canonical_data_migration'
           AND scope_id = 'global' AND document_id = ?`,
      )
      .get(OBLIGATION_MARKER_ID),
  );
}

function hasExactDeletionIndexes(database: DatabaseSync): boolean {
  return [
    ["durable_events_record", "durable_events", "record_id"],
    [
      "agent_context_leaves_active_record",
      "agent_context_leaves",
      "active_record_id",
    ],
  ].every(([name, table, column]) => {
    if (!tableExists(database, table)) return false;
    const index = (
      database
        .prepare(`PRAGMA index_list('${table}')`)
        .all() as unknown as Array<{
        name: string;
        unique: number;
        partial: number;
      }>
    ).find((candidate) => candidate.name === name);
    const columns = database
      .prepare(`PRAGMA index_info('${name}')`)
      .all() as unknown as Array<{ name: string }>;
    return (
      index?.unique === 0 &&
      index.partial === 0 &&
      columns.length === 1 &&
      columns[0]?.name === column
    );
  });
}

function tableExists(database: DatabaseSync, table: string): boolean {
  return Boolean(
    database
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(table),
  );
}

function addOrdinal(
  registry: readonly RegisteredStorageMigration[],
  adopted: Set<string>,
  ordinal: number,
): void {
  const step = registry.find((candidate) => candidate.ordinal === ordinal);
  if (step) adopted.add(step.id);
}

function errorCode(error: unknown): string | undefined {
  return error && typeof error === "object" && "code" in error
    ? String(error.code)
    : undefined;
}
