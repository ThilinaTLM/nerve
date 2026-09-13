import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { DeletionIntent } from "@nervekit/contracts/storage";
import { encode } from "./payload-codecs.js";

const stages = [
  "lifecycle_work",
  "recovery_actions",
  "execution_claims",
  "execution_attempts",
  "logical_effects",
  "authorizations",
  "checkpoints",
  "provider_phases",
  "execution_snapshots",
  "wait_group_members",
  "wait_groups",
  "run_controls",
  "search_projection_rows",
  "projection_rows",
  "projection_state",
  "context_boundaries",
  "ancestor_jumps",
  "entries",
  "transitions",
  "artifact_preparations",
] as const;
type HistoryStage = (typeof stages)[number];

export function removeDeletionHistoryChunk(
  database: DatabaseSync,
  intent: DeletionIntent,
  limit: number,
  now: string,
): { phase: DeletionIntent["phase"]; cursor?: string } {
  ensureTombstone(database, intent, now);
  const stage = parseStage(intent.cleanupCursor);
  const changes = deleteStage(database, intent.conversationId, stage, limit);
  if (changes >= limit)
    return { phase: "removing_history", cursor: `history:${stage}` };
  const next = stages[stages.indexOf(stage) + 1];
  return next
    ? { phase: "removing_history", cursor: `history:${next}` }
    : { phase: "retaining_replay_evidence" };
}

export function finalizeDeletionHistory(
  database: DatabaseSync,
  intent: DeletionIntent,
  now: string,
): void {
  const residual = database
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM conversation_entries WHERE conversation_id = ?1) +
         (SELECT COUNT(*) FROM conversation_transitions WHERE conversation_id = ?1) +
         (SELECT COUNT(*) FROM run_controls WHERE conversation_id = ?1) +
         (SELECT COUNT(*) FROM canonical_lifecycle_work
            WHERE conversation_id = ?1) +
         (SELECT COUNT(*) FROM context_boundaries WHERE conversation_id = ?1) +
         (SELECT COUNT(*) FROM artifact_deletion_work
            WHERE conversation_id = ?1 AND state NOT IN ('deleted','missing')) AS count`,
    )
    .get(intent.conversationId) as { count: number };
  if (residual.count !== 0) {
    throw new Error("Deletion history cleanup is incomplete.");
  }
  const tombstone = database
    .prepare(
      `SELECT 1 FROM owner_tombstones
       WHERE owner_kind = 'conversation' AND owner_id = ?1`,
    )
    .get(intent.conversationId);
  if (!tombstone) throw new Error("Deletion replay tombstone is missing.");
  database
    .prepare(
      `UPDATE deletion_intents
       SET phase = 'finalized', cleanup_cursor = NULL, updated_at_ms = ?
       WHERE conversation_id = ? AND phase = 'retaining_replay_evidence'`,
    )
    .run(Date.parse(now), intent.conversationId);
  database
    .prepare(
      `UPDATE conversations
       SET deletion_state = 'finalized', active_entry_id = NULL,
           foreground_run_id = NULL, updated_at_ms = ?
       WHERE conversation_id = ?`,
    )
    .run(Date.parse(now), intent.conversationId);
}

function ensureTombstone(
  database: DatabaseSync,
  intent: DeletionIntent,
  now: string,
): void {
  const identity = database
    .prepare(
      `SELECT namespace_id, execution_incarnation_id FROM state_identity WHERE singleton = 1`,
    )
    .get() as { namespace_id: string; execution_incarnation_id: string };
  const commandCount = Number(
    (
      database
        .prepare(
          `SELECT COUNT(*) AS count FROM command_receipts
           WHERE owner_kind = 'conversation' AND owner_id = ?1`,
        )
        .get(intent.conversationId) as { count: number }
    ).count,
  );
  const effectCount = Number(
    (
      database
        .prepare(
          `SELECT COUNT(*) AS count FROM logical_effects effects
           JOIN wait_group_members members USING(member_id)
           JOIN wait_groups groups USING(wait_group_id)
           JOIN run_controls runs ON runs.run_id = groups.run_id
           WHERE runs.conversation_id = ?1`,
        )
        .get(intent.conversationId) as { count: number }
    ).count,
  );
  const evidence = {
    schemaVersion: 1,
    deletionCommandId: intent.commandId,
    fenceRevision: intent.fenceRevision,
    uncertaintyAcknowledged: intent.uncertaintyAcknowledged,
    executionIncarnationId: identity.execution_incarnation_id,
  };
  database
    .prepare(
      `INSERT OR IGNORE INTO owner_tombstones (
         owner_kind, owner_id, namespace_id, command_reservation_count,
         effect_reservation_count, deleted_at_ms, replay_evidence_json
       ) VALUES ('conversation', ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      intent.conversationId,
      identity.namespace_id,
      commandCount,
      effectCount,
      Date.parse(now),
      encode({
        ...evidence,
        digest: `sha256:${createHash("sha256")
          .update(JSON.stringify(evidence))
          .digest("hex")}`,
      }),
    );
}

function deleteStage(
  database: DatabaseSync,
  conversationId: string,
  stage: HistoryStage,
  limit: number,
): number {
  if (stage === "lifecycle_work")
    return remove(
      database,
      "canonical_lifecycle_work",
      "work_id",
      "conversation_id = ?1",
      conversationId,
      limit,
    );
  if (stage === "recovery_actions")
    return remove(
      database,
      "recovery_actions",
      "action_id",
      "conversation_id = ?1",
      conversationId,
      limit,
    );
  if (stage === "execution_claims")
    return remove(
      database,
      "execution_claims",
      "claim_id",
      attemptScope("attempt_id"),
      conversationId,
      limit,
    );
  if (stage === "execution_attempts")
    return remove(
      database,
      "execution_attempts",
      "attempt_id",
      attemptConversationScope(),
      conversationId,
      limit,
    );
  if (stage === "logical_effects")
    return remove(
      database,
      "logical_effects",
      "effect_id",
      effectScope(),
      conversationId,
      limit,
    );
  if (stage === "authorizations")
    return remove(
      database,
      "exact_call_authorizations",
      "authorization_id",
      memberScope(),
      conversationId,
      limit,
    );
  if (stage === "checkpoints")
    return remove(
      database,
      "checkpoints",
      "checkpoint_id",
      "conversation_id = ?1",
      conversationId,
      limit,
    );
  if (stage === "provider_phases")
    return remove(
      database,
      "provider_phases",
      "phase_id",
      runScope("run_id"),
      conversationId,
      limit,
    );
  if (stage === "execution_snapshots")
    return remove(
      database,
      "execution_snapshots",
      "snapshot_id",
      runScope("run_id"),
      conversationId,
      limit,
    );
  if (stage === "wait_group_members")
    return remove(
      database,
      "wait_group_members",
      "member_id",
      groupScope("wait_group_id"),
      conversationId,
      limit,
    );
  if (stage === "wait_groups")
    return remove(
      database,
      "wait_groups",
      "wait_group_id",
      runScope("run_id"),
      conversationId,
      limit,
    );
  if (stage === "run_controls")
    return remove(
      database,
      "run_controls",
      "run_id",
      "conversation_id = ?1",
      conversationId,
      limit,
    );
  if (stage === "search_projection_rows")
    return remove(
      database,
      "timeline_search_projection_rows",
      "rowid",
      "conversation_id = ?1",
      conversationId,
      limit,
    );
  if (stage === "projection_rows")
    return remove(
      database,
      "transcript_projection_rows",
      "rowid",
      "conversation_id = ?1",
      conversationId,
      limit,
    );
  if (stage === "projection_state")
    return remove(
      database,
      "projection_state",
      "rowid",
      "conversation_id = ?1",
      conversationId,
      limit,
    );
  if (stage === "context_boundaries")
    return remove(
      database,
      "context_boundaries",
      "boundary_id",
      "conversation_id = ?1",
      conversationId,
      limit,
    );
  if (stage === "ancestor_jumps")
    return remove(
      database,
      "entry_ancestor_jumps",
      "rowid",
      "entry_id IN (SELECT entry_id FROM conversation_entries WHERE conversation_id = ?1)",
      conversationId,
      limit,
    );
  if (stage === "entries") {
    database
      .prepare(
        `UPDATE conversations SET active_entry_id = NULL WHERE conversation_id = ?1`,
      )
      .run(conversationId);
    return remove(
      database,
      "conversation_entries",
      "entry_id",
      "conversation_id = ?1",
      conversationId,
      limit,
    );
  }
  if (stage === "transitions")
    return remove(
      database,
      "conversation_transitions",
      "transition_id",
      "conversation_id = ?1",
      conversationId,
      limit,
    );
  return remove(
    database,
    "artifact_preparations",
    "preparation_id",
    "owner_kind = 'conversation' AND owner_id = ?1",
    conversationId,
    limit,
  );
}

function remove(
  database: DatabaseSync,
  table: string,
  key: string,
  predicate: string,
  conversationId: string,
  limit: number,
): number {
  return Number(
    database
      .prepare(
        `DELETE FROM ${table} WHERE ${key} IN (
           SELECT ${key} FROM ${table} WHERE ${predicate} ORDER BY ${key} LIMIT ?2
         )`,
      )
      .run(conversationId, limit).changes,
  );
}

function runScope(column: string): string {
  return `${column} IN (SELECT run_id FROM run_controls WHERE conversation_id = ?1)`;
}
function groupScope(column: string): string {
  return `${column} IN (SELECT wait_group_id FROM wait_groups WHERE run_id IN (SELECT run_id FROM run_controls WHERE conversation_id = ?1))`;
}
function memberScope(): string {
  return `member_id IN (SELECT member_id FROM wait_group_members WHERE wait_group_id IN (SELECT wait_group_id FROM wait_groups WHERE run_id IN (SELECT run_id FROM run_controls WHERE conversation_id = ?1)))`;
}
function effectScope(): string {
  return `member_id IN (SELECT member_id FROM wait_group_members WHERE wait_group_id IN (SELECT wait_group_id FROM wait_groups WHERE run_id IN (SELECT run_id FROM run_controls WHERE conversation_id = ?1)))`;
}
function attemptScope(column: string): string {
  return `${column} IN (SELECT attempt_id FROM execution_attempts WHERE ${attemptConversationScope()})`;
}
function attemptConversationScope(): string {
  return `(effect_id IN (SELECT effect_id FROM logical_effects WHERE ${effectScope()}) OR provider_phase_id IN (SELECT phase_id FROM provider_phases WHERE ${runScope("run_id")}))`;
}
function parseStage(cursor: string | undefined): HistoryStage {
  const value = cursor?.startsWith("history:") ? cursor.slice(8) : undefined;
  return stages.includes(value as HistoryStage)
    ? (value as HistoryStage)
    : stages[0];
}
