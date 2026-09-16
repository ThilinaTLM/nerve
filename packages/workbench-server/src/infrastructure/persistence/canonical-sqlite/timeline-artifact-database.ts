import type { DatabaseSync } from "node:sqlite";
import type { ArtifactReference } from "@nervekit/contracts/conversations";

export function insertTimelineFinalizedArtifact(
  database: DatabaseSync,
  artifact: ArtifactReference,
): void {
  if (artifact.availability !== "available") {
    throw new Error("A canonical artifact participant must be finalized.");
  }
  database
    .prepare(
      `INSERT OR IGNORE INTO artifact_preparations (
         preparation_id, artifact_id, owner_kind, owner_id, relative_locator,
         digest, byte_length, media_type, semantic_role, lease_state,
         expires_at_ms, manifest_id
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'finalized', NULL, NULL)`,
    )
    .run(
      `preparation_${artifact.artifactId}`,
      artifact.artifactId,
      artifact.ownerKind,
      artifact.ownerId,
      artifact.relativeLocator,
      artifact.digest,
      artifact.byteLength,
      artifact.mediaType,
      artifact.semanticRole,
    );
  assertTimelineArtifactFinalized(database, artifact);
}

export function assertTimelineArtifactFinalized(
  database: DatabaseSync,
  artifact: ArtifactReference,
): void {
  const row = database
    .prepare(
      `SELECT owner_kind, owner_id, relative_locator, digest, byte_length,
              media_type, semantic_role, lease_state
       FROM artifact_preparations WHERE artifact_id = ?`,
    )
    .get(artifact.artifactId) as
    | {
        owner_kind: string;
        owner_id: string;
        relative_locator: string;
        digest: string;
        byte_length: number;
        media_type: string;
        semantic_role: string;
        lease_state: string;
      }
    | undefined;
  if (
    !row ||
    row.owner_kind !== artifact.ownerKind ||
    row.owner_id !== artifact.ownerId ||
    row.relative_locator !== artifact.relativeLocator ||
    row.digest !== artifact.digest ||
    row.byte_length !== artifact.byteLength ||
    row.media_type !== artifact.mediaType ||
    row.semantic_role !== artifact.semanticRole ||
    (row.lease_state !== "finalized" && row.lease_state !== "referenced")
  ) {
    throw new Error(`Artifact ${artifact.artifactId} is not finalized.`);
  }
  database
    .prepare(
      `UPDATE artifact_preparations SET lease_state = 'referenced'
       WHERE artifact_id = ? AND lease_state = 'finalized'`,
    )
    .run(artifact.artifactId);
}
