import type { DatabaseSync } from "node:sqlite";
import {
  artifactReferenceSchema,
  canonicalAncestrySegmentSchema,
  canonicalConversationEntrySchema,
  timelineStateIdentitySchema,
  type CanonicalAncestrySegment,
  type CanonicalConversationEntry,
  mutationOutcomeSchema,
  type MutationOutcome,
  type TimelineStateIdentity,
} from "@nervekit/contracts/conversations";
import { runControlSchema, type RunControl } from "@nervekit/contracts/runs";
import { z } from "zod";
import { decode } from "./payload-codecs.js";

const entryArtifactManifestSchema = z.object({
  version: z.literal(1),
  artifacts: z.array(artifactReferenceSchema).max(32),
});

interface RunControlRow {
  conversation_id: string;
  run_id: string;
  generation: number;
  bound_selection_epoch: number;
  continuation_entry_id: string | null;
  checkpoint_id: string | null;
  wait_group_id: string | null;
  provider_phase_id: string | null;
  state: string;
  foreground_owned: number;
  revision: number;
}

interface EntryRow {
  entry_id: string;
  conversation_id: string;
  transition_id: string;
  ordinal: number;
  parent_entry_id: string | null;
  entry_kind: CanonicalConversationEntry["kind"];
  inline_content: Uint8Array | null;
  run_id: string | null;
  tool_call_id: string | null;
  interaction_id: string | null;
  provenance: Uint8Array;
  chain_index: number;
  artifact_manifest_data: Uint8Array | null;
}

export function readTimelineCommandReceipt(
  database: DatabaseSync,
  input: {
    namespaceId: string;
    operationKind: string;
    ownerKind: "state" | "conversation" | "policy_scope";
    ownerId: string;
    commandId: string;
    fingerprint: string;
  },
): MutationOutcome | undefined {
  const row = database
    .prepare(
      `SELECT fingerprint_hash, outcome_json FROM command_receipts
       WHERE namespace_id = ? AND operation_kind = ? AND owner_kind = ?
         AND owner_id = ? AND command_id = ?`,
    )
    .get(
      input.namespaceId,
      input.operationKind,
      input.ownerKind,
      input.ownerId,
      input.commandId,
    ) as { fingerprint_hash: string; outcome_json: Uint8Array } | undefined;
  if (!row) return undefined;
  if (row.fingerprint_hash !== input.fingerprint) {
    return {
      kind: "fingerprint_mismatch",
      commandId: input.commandId,
      retry: "never_with_same_command_id",
    };
  }
  const outcome = mutationOutcomeSchema.parse(decode(row.outcome_json));
  return outcome.kind === "committed"
    ? { ...outcome, kind: "receipt_replay" }
    : outcome;
}

export function readTimelineStateIdentity(
  database: DatabaseSync,
): TimelineStateIdentity | undefined {
  const row = database
    .prepare(
      `SELECT namespace_id, execution_incarnation_id, format_version,
              promoted_at_ms FROM state_identity WHERE singleton = 1`,
    )
    .get() as
    | {
        namespace_id: string;
        execution_incarnation_id: string;
        format_version: number;
        promoted_at_ms: number;
      }
    | undefined;
  if (!row) return undefined;
  return timelineStateIdentitySchema.parse({
    schemaVersion: 1,
    namespaceId: row.namespace_id,
    executionIncarnationId: row.execution_incarnation_id,
    formatVersion: row.format_version,
    promotedAt: new Date(row.promoted_at_ms).toISOString(),
  });
}

export function readTimelineRunControl(
  database: DatabaseSync,
  conversationId: string,
  runId: string,
): RunControl | undefined {
  const row = database
    .prepare(
      `SELECT conversation_id, run_id, generation, bound_selection_epoch,
              continuation_entry_id, checkpoint_id, wait_group_id,
              provider_phase_id, effective_state AS state,
              foreground_owned, revision
       FROM run_controls WHERE conversation_id = ? AND run_id = ?`,
    )
    .get(conversationId, runId) as RunControlRow | undefined;
  if (!row) return undefined;
  return runControlSchema.parse({
    schemaVersion: 1,
    conversationId: row.conversation_id,
    runId: row.run_id,
    generation: row.generation,
    boundSelectionEpoch: row.bound_selection_epoch,
    continuationEntryId: row.continuation_entry_id,
    checkpointId: row.checkpoint_id,
    waitGroupId: row.wait_group_id,
    providerPhaseId: row.provider_phase_id,
    state: row.state,
    foregroundOwned: row.foreground_owned === 1,
    revision: row.revision,
  });
}

export function readTimelineAncestrySegment(
  database: DatabaseSync,
  input: {
    conversationId: string;
    sourceEntryId: string;
    limit: number;
  },
): CanonicalAncestrySegment {
  if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 512) {
    throw new RangeError("Timeline ancestry limit must be between 1 and 512.");
  }
  const rows = database
    .prepare(
      `WITH RECURSIVE chain AS (
         SELECT e.*, 0 AS chain_index
         FROM conversation_entries e
         WHERE e.conversation_id = ? AND e.entry_id = ?
         UNION ALL
         SELECT parent.*, chain.chain_index + 1
         FROM conversation_entries parent
         JOIN chain ON parent.entry_id = chain.parent_entry_id
         WHERE parent.conversation_id = ? AND chain.chain_index + 1 < ?
       )
       SELECT chain.entry_id, chain.conversation_id, chain.transition_id,
              chain.ordinal, chain.parent_entry_id, chain.kind AS entry_kind,
              chain.inline_content_json AS inline_content, chain.run_id,
              chain.tool_call_id, chain.interaction_id,
              chain.provenance_json AS provenance, chain.chain_index,
              artifact_manifests.data AS artifact_manifest_data
       FROM chain
       LEFT JOIN artifact_manifests
         ON artifact_manifests.manifest_id = chain.artifact_manifest_id
       ORDER BY chain.chain_index`,
    )
    .all(
      input.conversationId,
      input.sourceEntryId,
      input.conversationId,
      input.limit,
    ) as unknown as EntryRow[];
  if (rows.length === 0) {
    throw new Error(`Timeline entry '${input.sourceEntryId}' was not found.`);
  }
  const entries = rows.map((row) =>
    canonicalConversationEntrySchema.parse({
      schemaVersion: 1,
      entryId: row.entry_id,
      conversationId: row.conversation_id,
      transitionId: row.transition_id,
      ordinal: row.ordinal,
      parentEntryId: row.parent_entry_id,
      kind: row.entry_kind,
      ...(row.inline_content
        ? { inlineContent: decode(row.inline_content) }
        : {}),
      artifacts: row.artifact_manifest_data
        ? entryArtifactManifestSchema.parse(decode(row.artifact_manifest_data))
            .artifacts
        : [],
      ...(row.run_id ? { runId: row.run_id } : {}),
      ...(row.tool_call_id ? { toolCallId: row.tool_call_id } : {}),
      ...(row.interaction_id ? { interactionId: row.interaction_id } : {}),
      provenance: decode(row.provenance),
    }),
  );
  const oldest = entries.at(-1)!;
  const nextAncestorEntryId =
    entries.length === input.limit
      ? (oldest.parentEntryId ?? undefined)
      : undefined;
  return canonicalAncestrySegmentSchema.parse({
    conversationId: input.conversationId,
    sourceEntryId: input.sourceEntryId,
    entries,
    ...(nextAncestorEntryId ? { nextAncestorEntryId } : {}),
    ordering: "ancestry_descending",
  });
}
