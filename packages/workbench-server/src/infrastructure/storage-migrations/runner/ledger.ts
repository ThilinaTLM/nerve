import type { DatabaseSync } from "node:sqlite";

export const STORAGE_MIGRATION_METADATA_SQL = `
CREATE TABLE IF NOT EXISTS storage_migrations (
  id TEXT PRIMARY KEY,
  ordinal INTEGER NOT NULL UNIQUE,
  kind TEXT NOT NULL,
  checksum TEXT NOT NULL,
  stage TEXT NOT NULL CHECK(stage IN ('draft','final','released')),
  app_version TEXT NOT NULL,
  git_sha TEXT,
  applied_at_ms INTEGER NOT NULL,
  duration_ms INTEGER NOT NULL,
  quarantined INTEGER NOT NULL DEFAULT 0,
  origin TEXT NOT NULL CHECK(origin IN ('applied','adopted'))
) STRICT;
CREATE TABLE IF NOT EXISTS storage_read_sweeps (
  build_id TEXT PRIMARY KEY,
  swept_at_ms INTEGER NOT NULL,
  quarantined INTEGER NOT NULL
) STRICT;
CREATE TABLE IF NOT EXISTS storage_quarantine (
  id TEXT PRIMARY KEY,
  source_step TEXT NOT NULL,
  unit TEXT NOT NULL CHECK(unit IN ('record','conversation','config','file')),
  source TEXT NOT NULL,
  source_key TEXT NOT NULL,
  conversation_id TEXT,
  reason TEXT NOT NULL,
  original BLOB,
  affected_records INTEGER NOT NULL,
  affected_bytes INTEGER NOT NULL,
  created_at_ms INTEGER NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS storage_quarantine_conversation
  ON storage_quarantine(conversation_id)
  WHERE conversation_id IS NOT NULL;
`;

export type StorageMigrationStage = "draft" | "final" | "released";
export type StorageMigrationKind = "schema" | "data" | "files" | "config";
export type StorageMigrationOrigin = "applied" | "adopted";

export interface StorageMigrationLedgerRow {
  id: string;
  ordinal: number;
  kind: StorageMigrationKind;
  checksum: string;
  stage: StorageMigrationStage;
  appVersion: string;
  gitSha?: string;
  appliedAtMs: number;
  durationMs: number;
  quarantined: number;
  origin: StorageMigrationOrigin;
}

export interface StorageReadSweepRow {
  readCompatibilityId: string;
  sweptAtMs: number;
  quarantined: number;
}

/** Metadata is bootstrapped only in a new database or a migration workspace. */
export function initializeStorageMigrationLedger(database: DatabaseSync): void {
  database.exec(STORAGE_MIGRATION_METADATA_SQL);
}

export function hasStorageMigrationLedger(database: DatabaseSync): boolean {
  const row = database
    .prepare(
      `SELECT 1 AS present FROM sqlite_master
       WHERE type = 'table' AND name = 'storage_migrations'`,
    )
    .get() as { present?: number } | undefined;
  return row?.present === 1;
}

export function readStorageMigrationLedger(
  database: DatabaseSync,
): StorageMigrationLedgerRow[] {
  if (!hasStorageMigrationLedger(database)) return [];
  const rows = database
    .prepare(
      `SELECT id, ordinal, kind, checksum, stage, app_version, git_sha,
              applied_at_ms, duration_ms, quarantined, origin
       FROM storage_migrations ORDER BY ordinal`,
    )
    .all() as unknown as Array<{
    id: string;
    ordinal: number;
    kind: StorageMigrationKind;
    checksum: string;
    stage: StorageMigrationStage;
    app_version: string;
    git_sha: string | null;
    applied_at_ms: number;
    duration_ms: number;
    quarantined: number;
    origin: StorageMigrationOrigin;
  }>;
  return rows.map((row) => ({
    id: row.id,
    ordinal: row.ordinal,
    kind: row.kind,
    checksum: row.checksum,
    stage: row.stage,
    appVersion: row.app_version,
    ...(row.git_sha ? { gitSha: row.git_sha } : {}),
    appliedAtMs: row.applied_at_ms,
    durationMs: row.duration_ms,
    quarantined: row.quarantined,
    origin: row.origin,
  }));
}

export function recordStorageMigration(
  database: DatabaseSync,
  row: StorageMigrationLedgerRow,
): void {
  database
    .prepare(
      `INSERT INTO storage_migrations (
         id, ordinal, kind, checksum, stage, app_version, git_sha,
         applied_at_ms, duration_ms, quarantined, origin
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      row.id,
      row.ordinal,
      row.kind,
      row.checksum,
      row.stage,
      row.appVersion,
      row.gitSha ?? null,
      row.appliedAtMs,
      row.durationMs,
      row.quarantined,
      row.origin,
    );
}

export function hasReadSweep(
  database: DatabaseSync,
  readCompatibilityId: string,
): boolean {
  if (!hasStorageMigrationLedger(database)) return false;
  return Boolean(
    database
      .prepare("SELECT 1 FROM storage_read_sweeps WHERE build_id = ?")
      .get(readCompatibilityId),
  );
}

/** The historical build_id column stores opaque readability evidence keys. */
export function readStorageReadSweepIds(database: DatabaseSync): string[] {
  if (!hasStorageMigrationLedger(database)) return [];
  return (
    database
      .prepare("SELECT build_id FROM storage_read_sweeps")
      .all() as Array<{
      build_id: string;
    }>
  ).map((row) => row.build_id);
}

export function recordReadSweep(
  database: DatabaseSync,
  row: StorageReadSweepRow,
): void {
  database
    .prepare(
      `INSERT INTO storage_read_sweeps (build_id, swept_at_ms, quarantined)
       VALUES (?, ?, ?)
       ON CONFLICT(build_id) DO UPDATE SET
         swept_at_ms = excluded.swept_at_ms,
         quarantined = excluded.quarantined`,
    )
    .run(row.readCompatibilityId, row.sweptAtMs, row.quarantined);
}
