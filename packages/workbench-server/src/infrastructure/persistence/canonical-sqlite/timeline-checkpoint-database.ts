import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type {
  CanonicalCheckpoint,
  ImmutableExecutionSnapshot,
} from "@nervekit/contracts/runs";
import { encode } from "./payload-codecs.js";

export interface TimelineArtifactManifestWrite {
  manifestId: string;
  schemaVersion: number;
  data: unknown;
}

export function insertTimelineArtifactManifest(
  database: DatabaseSync,
  manifest: TimelineArtifactManifestWrite,
  now: string,
): void {
  if (
    !manifest.manifestId.startsWith("manifest_") ||
    !Number.isInteger(manifest.schemaVersion) ||
    manifest.schemaVersion < 1
  ) {
    throw new Error("Artifact manifest identity or version is invalid.");
  }
  const data = encode(manifest.data);
  const digest = `sha256:${createHash("sha256").update(data).digest("hex")}`;
  database
    .prepare(
      `INSERT INTO artifact_manifests (
         manifest_id, schema_version, digest, byte_length, data, created_at_ms
       ) VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      manifest.manifestId,
      manifest.schemaVersion,
      digest,
      data.byteLength,
      data,
      Date.parse(now),
    );
}

export function insertTimelineExecutionSnapshot(
  database: DatabaseSync,
  snapshot: ImmutableExecutionSnapshot,
): void {
  database
    .prepare(
      `INSERT INTO execution_snapshots (
         snapshot_id, run_id, schema_version, compatibility_version,
         manifest_id, digest, model_context_recipe_version,
         opaque_provider_state_manifest_id, created_at_ms
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      snapshot.snapshotId,
      snapshot.runId,
      snapshot.schemaVersion,
      snapshot.compatibilityVersion,
      snapshot.manifestId,
      snapshot.digest,
      snapshot.modelContextRecipeVersion,
      snapshot.opaqueProviderStateManifestId ?? null,
      Date.parse(snapshot.createdAt),
    );
}

export function insertTimelineCheckpoint(
  database: DatabaseSync,
  checkpoint: CanonicalCheckpoint,
): void {
  const transition = database
    .prepare(
      `SELECT conversation_id, revision FROM conversation_transitions
       WHERE transition_id = ?`,
    )
    .get(checkpoint.captureTransitionId) as
    | { conversation_id: string; revision: number }
    | undefined;
  const run = database
    .prepare(
      `SELECT conversation_id, generation, bound_selection_epoch
       FROM run_controls WHERE run_id = ?`,
    )
    .get(checkpoint.runId) as
    | {
        conversation_id: string;
        generation: number;
        bound_selection_epoch: number;
      }
    | undefined;
  if (
    transition?.conversation_id !== checkpoint.conversationId ||
    transition.revision !== checkpoint.captureRevision ||
    run?.conversation_id !== checkpoint.conversationId ||
    run.generation !== checkpoint.runGeneration ||
    run.bound_selection_epoch !== checkpoint.selectionEpoch
  ) {
    throw new Error("Checkpoint capture fences do not match canonical state.");
  }
  database
    .prepare(
      `INSERT INTO checkpoints (
         checkpoint_id, conversation_id, run_id, agent_id, capture_revision,
         capture_transition_id, anchor_entry_id, selection_epoch,
         run_generation, execution_phase, snapshot_id, pending_manifest_id,
         wait_group_id, context_recipe_version, integrity_hash, created_at_ms
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      checkpoint.checkpointId,
      checkpoint.conversationId,
      checkpoint.runId,
      checkpoint.agentId,
      checkpoint.captureRevision,
      checkpoint.captureTransitionId,
      checkpoint.anchorEntryId,
      checkpoint.selectionEpoch,
      checkpoint.runGeneration,
      checkpoint.executionPhase,
      checkpoint.snapshotId,
      checkpoint.pendingManifestId,
      checkpoint.waitGroupId,
      checkpoint.contextRecipeVersion,
      checkpoint.integrityHash,
      Date.parse(checkpoint.createdAt),
    );
}
