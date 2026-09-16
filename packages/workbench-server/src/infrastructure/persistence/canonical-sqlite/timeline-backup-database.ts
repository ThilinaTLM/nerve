import type { DatabaseSync } from "node:sqlite";

export interface BackupArtifactRecord {
  artifactId: string;
  ownerId: string;
  relativeLocator: string;
  digest: string;
  byteLength: number;
}

export class CanonicalBackupDatabase {
  constructor(private readonly database: DatabaseSync) {}

  createSnapshot(destination: string): BackupArtifactRecord[] {
    createTimelineBackupSnapshot(this.database, destination);
    return listTimelineBackupArtifacts(this.database);
  }
}

/** Runs on the sole writer after all earlier commands, yielding a consistent snapshot. */
export function createTimelineBackupSnapshot(
  database: DatabaseSync,
  destination: string,
): void {
  database.exec("PRAGMA wal_checkpoint(PASSIVE)");
  database.prepare("VACUUM INTO ?").run(destination);
}

export function listTimelineBackupArtifacts(
  database: DatabaseSync,
): BackupArtifactRecord[] {
  return (
    database
      .prepare(
        `SELECT artifact_id, owner_id, relative_locator, digest, byte_length
         FROM artifact_preparations
         WHERE lease_state IN ('finalized','referenced')
         ORDER BY relative_locator, artifact_id`,
      )
      .all() as unknown as {
      artifact_id: string;
      owner_id: string;
      relative_locator: string;
      digest: string;
      byte_length: number;
    }[]
  ).map((row) => ({
    artifactId: row.artifact_id,
    ownerId: row.owner_id,
    relativeLocator: row.relative_locator,
    digest: row.digest,
    byteLength: row.byte_length,
  }));
}
