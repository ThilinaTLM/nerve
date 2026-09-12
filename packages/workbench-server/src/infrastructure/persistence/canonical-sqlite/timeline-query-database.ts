import type { DatabaseSync } from "node:sqlite";
import {
  artifactReferenceSchema,
  canonicalAncestrySegmentSchema,
  canonicalConversationEntrySchema,
  conversationHeadSchema,
  timelineStateIdentitySchema,
  type CanonicalAncestrySegment,
  type CanonicalConversationEntry,
  mutationOutcomeSchema,
  type ConversationHead,
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

export interface EntryRow {
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

export function timelineEntryIsAncestor(
  database: DatabaseSync,
  conversationId: string,
  ancestorEntryId: string | null,
  descendantEntryId: string | null,
): boolean {
  if (ancestorEntryId === null) return true;
  if (descendantEntryId === null) return false;
  const rows = database
    .prepare(
      `SELECT entry_id, conversation_id, ancestry_depth
       FROM conversation_entries WHERE entry_id IN (?, ?)`,
    )
    .all(ancestorEntryId, descendantEntryId) as unknown as Array<{
    entry_id: string;
    conversation_id: string;
    ancestry_depth: number;
  }>;
  const ancestor = rows.find((row) => row.entry_id === ancestorEntryId);
  const descendant = rows.find((row) => row.entry_id === descendantEntryId);
  if (
    !ancestor ||
    !descendant ||
    ancestor.conversation_id !== conversationId ||
    descendant.conversation_id !== conversationId ||
    ancestor.ancestry_depth > descendant.ancestry_depth
  ) {
    return false;
  }
  let cursor = descendant.entry_id;
  let distance = descendant.ancestry_depth - ancestor.ancestry_depth;
  for (let power = 0; distance > 0 && power < 63; power += 1) {
    if (distance % 2 === 1) {
      const jump = database
        .prepare(
          `SELECT ancestor_entry_id FROM entry_ancestor_jumps
           WHERE entry_id = ? AND power = ?`,
        )
        .get(cursor, power) as { ancestor_entry_id: string } | undefined;
      if (!jump) return false;
      cursor = jump.ancestor_entry_id;
    }
    distance = Math.floor(distance / 2);
  }
  return cursor === ancestorEntryId;
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

export function readTimelineDeletionState(
  database: DatabaseSync,
  conversationId: string,
): "active" | "pending" | "finalized" | undefined {
  return (
    database
      .prepare(
        `SELECT deletion_state FROM conversations WHERE conversation_id = ?`,
      )
      .get(conversationId) as
      | { deletion_state: "active" | "pending" | "finalized" }
      | undefined
  )?.deletion_state;
}

export function readTimelineHeadAtRevision(
  database: DatabaseSync,
  conversationId: string,
  revision: number,
): ConversationHead | undefined {
  if (revision === 0) {
    const exists = database
      .prepare(
        `SELECT 1 AS present FROM conversations WHERE conversation_id = ?`,
      )
      .get(conversationId) as { present: number } | undefined;
    return exists
      ? {
          schemaVersion: 1,
          conversationId,
          revision: 0,
          activeEntryId: null,
          selectionEpoch: 0,
          foregroundRunId: null,
        }
      : undefined;
  }
  const row = database
    .prepare(
      `SELECT resulting_control_json FROM conversation_transitions
       WHERE conversation_id = ? AND revision = ?`,
    )
    .get(conversationId, revision) as
    | { resulting_control_json: Uint8Array }
    | undefined;
  return row
    ? conversationHeadSchema.parse(decode(row.resulting_control_json))
    : undefined;
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
  const entries = rows.map(entryFromRow);
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

export interface TimelineTreePageKey {
  revision: number;
  ordinal: number;
  entryId: string;
}

export function readTimelineFixedTreePage(
  database: DatabaseSync,
  input: {
    conversationId: string;
    sourceRevision: number;
    after?: TimelineTreePageKey;
    limit: number;
  },
): { entries: CanonicalConversationEntry[]; nextAfter?: TimelineTreePageKey } {
  if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 200) {
    throw new RangeError("Timeline tree page limit must be between 1 and 200.");
  }
  const rows = database
    .prepare(
      `SELECT entries.entry_id, entries.conversation_id, entries.transition_id,
              entries.ordinal, entries.parent_entry_id,
              entries.kind AS entry_kind,
              entries.inline_content_json AS inline_content, entries.run_id,
              entries.tool_call_id, entries.interaction_id,
              entries.provenance_json AS provenance,
              transitions.revision AS chain_index,
              artifact_manifests.data AS artifact_manifest_data
       FROM conversation_entries entries
       JOIN conversation_transitions transitions
         ON transitions.conversation_id = entries.conversation_id
        AND transitions.transition_id = entries.transition_id
       LEFT JOIN artifact_manifests
         ON artifact_manifests.manifest_id = entries.artifact_manifest_id
       WHERE entries.conversation_id = ? AND transitions.revision <= ?
         AND (
           ? IS NULL OR transitions.revision > ?
           OR (transitions.revision = ? AND entries.ordinal > ?)
           OR (transitions.revision = ? AND entries.ordinal = ? AND entries.entry_id > ?)
         )
       ORDER BY transitions.revision, entries.ordinal, entries.entry_id
       LIMIT ?`,
    )
    .all(
      input.conversationId,
      input.sourceRevision,
      input.after?.revision ?? null,
      input.after?.revision ?? null,
      input.after?.revision ?? null,
      input.after?.ordinal ?? null,
      input.after?.revision ?? null,
      input.after?.ordinal ?? null,
      input.after?.entryId ?? null,
      input.limit + 1,
    ) as unknown as EntryRow[];
  const hasMore = rows.length > input.limit;
  const pageRows = hasMore ? rows.slice(0, input.limit) : rows;
  const last = pageRows.at(-1);
  return {
    entries: pageRows.map(entryFromRow),
    ...(hasMore && last
      ? {
          nextAfter: {
            revision: last.chain_index,
            ordinal: last.ordinal,
            entryId: last.entry_id,
          },
        }
      : {}),
  };
}

export function readTimelineFixedAncestryPage(
  database: DatabaseSync,
  input: {
    conversationId: string;
    sourceEntryId: string;
    beforeDepth?: number;
    limit: number;
  },
): { entries: CanonicalConversationEntry[]; nextBeforeDepth?: number } {
  if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 200) {
    throw new RangeError("Timeline page limit must be between 1 and 200.");
  }
  if (
    input.beforeDepth !== undefined &&
    (!Number.isSafeInteger(input.beforeDepth) || input.beforeDepth < 1)
  ) {
    throw new RangeError("Timeline page depth is invalid.");
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
         WHERE parent.conversation_id = ?
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
       WHERE (? IS NULL OR chain.chain_index < ?)
       ORDER BY chain.chain_index DESC
       LIMIT ?`,
    )
    .all(
      input.conversationId,
      input.sourceEntryId,
      input.conversationId,
      input.beforeDepth ?? null,
      input.beforeDepth ?? null,
      input.limit + 1,
    ) as unknown as EntryRow[];
  if (rows.length === 0 && input.beforeDepth === undefined) {
    throw new Error(`Timeline entry '${input.sourceEntryId}' was not found.`);
  }
  const hasMore = rows.length > input.limit;
  const pageRows = hasMore ? rows.slice(0, input.limit) : rows;
  const last = pageRows.at(-1);
  return {
    entries: pageRows.map(entryFromRow),
    ...(hasMore && last ? { nextBeforeDepth: last.chain_index } : {}),
  };
}

export function entryFromRow(row: EntryRow): CanonicalConversationEntry {
  return canonicalConversationEntrySchema.parse({
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
  });
}
