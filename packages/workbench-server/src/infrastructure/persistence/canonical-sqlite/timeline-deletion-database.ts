import type { DatabaseSync } from "node:sqlite";
import type { DeletionIntent } from "@nervekit/contracts/storage";

const phaseTransitions: Readonly<
  Record<DeletionIntent["phase"], readonly DeletionIntent["phase"][]>
> = {
  fenced: ["settling_execution"],
  settling_execution: ["removing_payloads"],
  removing_payloads: ["removing_history"],
  removing_history: ["retaining_replay_evidence"],
  retaining_replay_evidence: ["finalized"],
  finalized: [],
};

export function persistTimelineDeletionIntent(
  database: DatabaseSync,
  intent: DeletionIntent,
): void {
  const current = database
    .prepare(
      `SELECT command_id, fence_revision, phase, uncertainty_acknowledged,
              created_at_ms
       FROM deletion_intents WHERE conversation_id = ?`,
    )
    .get(intent.conversationId) as
    | {
        command_id: string;
        fence_revision: number;
        phase: DeletionIntent["phase"];
        uncertainty_acknowledged: number;
        created_at_ms: number;
      }
    | undefined;
  if (!current) {
    const conversation = database
      .prepare(
        `SELECT revision, deletion_state FROM conversations WHERE conversation_id = ?`,
      )
      .get(intent.conversationId) as
      | { revision: number; deletion_state: string }
      | undefined;
    if (
      intent.phase !== "fenced" ||
      !conversation ||
      conversation.revision !== intent.fenceRevision ||
      conversation.deletion_state !== "active"
    ) {
      throw new Error(
        "A deletion intent must begin at its committed fence revision.",
      );
    }
    database
      .prepare(
        `INSERT INTO deletion_intents (
           conversation_id, command_id, fence_revision, phase, cleanup_cursor,
           uncertainty_acknowledged, created_at_ms, updated_at_ms
         ) VALUES (?, ?, ?, 'fenced', ?, ?, ?, ?)`,
      )
      .run(
        intent.conversationId,
        intent.commandId,
        intent.fenceRevision,
        intent.cleanupCursor ?? null,
        intent.uncertaintyAcknowledged ? 1 : 0,
        Date.parse(intent.createdAt),
        Date.parse(intent.updatedAt),
      );
    database
      .prepare(
        `UPDATE conversations SET deletion_state = 'pending'
         WHERE conversation_id = ? AND deletion_state = 'active'`,
      )
      .run(intent.conversationId);
    return;
  }
  if (
    current.command_id !== intent.commandId ||
    current.fence_revision !== intent.fenceRevision ||
    current.created_at_ms !== Date.parse(intent.createdAt) ||
    !phaseTransitions[current.phase].includes(intent.phase) ||
    (current.uncertainty_acknowledged === 1 && !intent.uncertaintyAcknowledged)
  ) {
    throw new Error("Deletion intent identity or phase transition is invalid.");
  }
  if (intent.phase === "finalized") assertDeletionCanFinalize(database, intent);
  const changed = database
    .prepare(
      `UPDATE deletion_intents
       SET phase = ?, cleanup_cursor = ?, uncertainty_acknowledged = ?, updated_at_ms = ?
       WHERE conversation_id = ? AND phase = ?`,
    )
    .run(
      intent.phase,
      intent.cleanupCursor ?? null,
      intent.uncertaintyAcknowledged ? 1 : 0,
      Date.parse(intent.updatedAt),
      intent.conversationId,
      current.phase,
    );
  if (changed.changes !== 1) throw new Error("Deletion intent phase conflict.");
  database
    .prepare(
      `UPDATE conversations SET deletion_state = ? WHERE conversation_id = ?`,
    )
    .run(
      intent.phase === "finalized" ? "finalized" : "pending",
      intent.conversationId,
    );
}

function assertDeletionCanFinalize(
  database: DatabaseSync,
  intent: DeletionIntent,
): void {
  const row = database
    .prepare(
      `SELECT
         EXISTS(
           SELECT 1 FROM run_controls
           WHERE conversation_id = ? AND foreground_owned = 1
         ) AS has_foreground,
         EXISTS(
           SELECT 1 FROM execution_claims claims
           JOIN execution_attempts attempts ON attempts.attempt_id = claims.attempt_id
           LEFT JOIN logical_effects effects ON effects.effect_id = attempts.effect_id
           LEFT JOIN wait_group_members members ON members.member_id = effects.member_id
           LEFT JOIN wait_groups groups ON groups.wait_group_id = members.wait_group_id
           LEFT JOIN run_controls effect_runs ON effect_runs.run_id = groups.run_id
           LEFT JOIN provider_phases phases ON phases.phase_id = attempts.provider_phase_id
           LEFT JOIN run_controls provider_runs ON provider_runs.run_id = phases.run_id
           WHERE claims.state = 'active'
             AND COALESCE(effect_runs.conversation_id, provider_runs.conversation_id) = ?
         ) AS has_claim,
         EXISTS(
           SELECT 1 FROM logical_effects effects
           JOIN wait_group_members members ON members.member_id = effects.member_id
           JOIN wait_groups groups ON groups.wait_group_id = members.wait_group_id
           JOIN run_controls runs ON runs.run_id = groups.run_id
           WHERE runs.conversation_id = ?
             AND effects.state IN ('dispatching','outcome_unknown','result_unavailable')
         ) AS has_uncertainty`,
    )
    .get(
      intent.conversationId,
      intent.conversationId,
      intent.conversationId,
    ) as {
    has_foreground: number;
    has_claim: number;
    has_uncertainty: number;
  };
  if (
    row.has_foreground === 1 ||
    row.has_claim === 1 ||
    (row.has_uncertainty === 1 && !intent.uncertaintyAcknowledged)
  ) {
    throw new Error("Deletion finalization predicates are not satisfied.");
  }
}
