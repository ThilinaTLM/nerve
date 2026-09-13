import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import {
  artifactDeletionWorkSchema,
  deletionIntentSchema,
  type ArtifactDeletionWork,
  ownerTombstoneSchema,
  type DeletionIntent,
  type OwnerTombstone,
} from "@nervekit/contracts/storage";
import { decode, encode } from "./payload-codecs.js";
import {
  finalizeDeletionHistory,
  removeDeletionHistoryChunk,
} from "./timeline-deletion-history-database.js";

const payloadStages = [
  "entries",
  "receipts",
  "manifests",
  "preparations",
] as const;
type PayloadStage = (typeof payloadStages)[number];

export class CanonicalDeletionCleanupDatabase {
  constructor(private readonly database: DatabaseSync) {}

  listPendingConversationIds(limit: number): string[] {
    return (
      this.database
        .prepare(
          `SELECT conversation_id FROM deletion_intents
           WHERE phase <> 'finalized'
           ORDER BY updated_at_ms, conversation_id LIMIT ?`,
        )
        .all(limit) as unknown as { conversation_id: string }[]
    ).map((row) => row.conversation_id);
  }

  readIntent(conversationId: string): DeletionIntent | undefined {
    return readIntent(this.database, conversationId);
  }

  readTombstone(conversationId: string): OwnerTombstone | undefined {
    const row = this.database
      .prepare(
        `SELECT namespace_id, command_reservation_count,
                effect_reservation_count, deleted_at_ms, replay_evidence_json
         FROM owner_tombstones
         WHERE owner_kind = 'conversation' AND owner_id = ?`,
      )
      .get(conversationId) as
      | {
          namespace_id: string;
          command_reservation_count: number;
          effect_reservation_count: number;
          deleted_at_ms: number;
          replay_evidence_json: Uint8Array;
        }
      | undefined;
    if (!row) return undefined;
    const evidence = decode(row.replay_evidence_json) as { digest?: unknown };
    return ownerTombstoneSchema.parse({
      schemaVersion: 1,
      ownerKind: "conversation",
      ownerId: conversationId,
      namespaceId: row.namespace_id,
      commandReservationCount: row.command_reservation_count,
      effectReservationCount: row.effect_reservation_count,
      replayEvidenceDigest: evidence.digest,
      deletedAt: new Date(row.deleted_at_ms).toISOString(),
    });
  }

  settleExecution(conversationId: string, now: string): DeletionIntent {
    return inImmediateTransaction(this.database, () => {
      const intent = requireIntent(this.database, conversationId);
      if (intent.phase === "fenced") {
        fenceExecution(this.database, conversationId);
        updateIntent(
          this.database,
          intent,
          "settling_execution",
          undefined,
          now,
        );
      } else if (intent.phase === "settling_execution") {
        assertNoActiveClaims(this.database, conversationId);
        planArtifactDeletion(this.database, conversationId, now);
        updateIntent(
          this.database,
          intent,
          "removing_payloads",
          "entries",
          now,
        );
      }
      return requireIntent(this.database, conversationId);
    });
  }

  claimArtifactWork(
    conversationId: string,
    limit: number,
    now: string,
  ): ArtifactDeletionWork[] {
    return inImmediateTransaction(this.database, () => {
      const intent = requireIntent(this.database, conversationId);
      if (intent.phase !== "removing_payloads") return [];
      const rows = this.database
        .prepare(
          `SELECT work_id FROM artifact_deletion_work
           WHERE conversation_id = ? AND (
             state IN ('planned','failed') OR
             (state = 'deleting' AND updated_at_ms < ?)
           ) ORDER BY work_id LIMIT ?`,
        )
        .all(conversationId, Date.parse(now) - 30_000, limit) as unknown as {
        work_id: string;
      }[];
      const update = this.database.prepare(
        `UPDATE artifact_deletion_work
         SET state = 'deleting', attempt_count = attempt_count + 1,
             last_error = NULL, updated_at_ms = ?
         WHERE work_id = ? AND (
           state IN ('planned','failed') OR
           (state = 'deleting' AND updated_at_ms < ?)
         )`,
      );
      for (const row of rows) {
        update.run(Date.parse(now), row.work_id, Date.parse(now) - 30_000);
      }
      return rows
        .map((row) => readArtifactWork(this.database, row.work_id))
        .filter((work): work is ArtifactDeletionWork => Boolean(work));
    });
  }

  settleArtifactWork(
    workId: string,
    state: "deleted" | "missing" | "failed",
    error: string | undefined,
    now: string,
  ): void {
    inImmediateTransaction(this.database, () => {
      const changed = this.database
        .prepare(
          `UPDATE artifact_deletion_work
           SET state = ?, last_error = ?, updated_at_ms = ?
           WHERE work_id = ? AND state = 'deleting'`,
        )
        .run(state, error ?? null, Date.parse(now), workId);
      if (changed.changes !== 1) {
        throw new Error(`Artifact deletion work '${workId}' is not claimed.`);
      }
    });
  }

  removeHistoryChunk(
    conversationId: string,
    limit: number,
    now: string,
  ): DeletionIntent {
    return inImmediateTransaction(this.database, () => {
      const intent = requireIntent(this.database, conversationId);
      if (intent.phase === "retaining_replay_evidence") {
        finalizeDeletionHistory(this.database, intent, now);
        return requireIntent(this.database, conversationId);
      }
      if (intent.phase !== "removing_history") return intent;
      const next = removeDeletionHistoryChunk(
        this.database,
        intent,
        limit,
        now,
      );
      updateIntent(this.database, intent, next.phase, next.cursor, now);
      return requireIntent(this.database, conversationId);
    });
  }

  redactPayloadChunk(
    conversationId: string,
    limit: number,
    now: string,
  ): DeletionIntent {
    return inImmediateTransaction(this.database, () => {
      const intent = requireIntent(this.database, conversationId);
      if (intent.phase !== "removing_payloads") return intent;
      assertArtifactDeletionSettled(this.database, conversationId);
      const stage = parsePayloadStage(intent.cleanupCursor);
      const changes = redactStage(
        this.database,
        conversationId,
        stage,
        limit,
        now,
      );
      if (changes < limit) {
        const index = payloadStages.indexOf(stage);
        const next = payloadStages[index + 1];
        if (!next) assertDeletionUncertaintyResolved(this.database, intent);
        updateIntent(
          this.database,
          intent,
          next ? "removing_payloads" : "removing_history",
          next,
          now,
        );
      }
      return requireIntent(this.database, conversationId);
    });
  }
}

function fenceExecution(database: DatabaseSync, conversationId: string): void {
  const attemptScope = `(
    SELECT attempts.attempt_id FROM execution_attempts attempts
    LEFT JOIN logical_effects effects ON effects.effect_id = attempts.effect_id
    LEFT JOIN wait_group_members members ON members.member_id = effects.member_id
    LEFT JOIN wait_groups groups ON groups.wait_group_id = members.wait_group_id
    LEFT JOIN provider_phases phases ON phases.phase_id = attempts.provider_phase_id
    WHERE groups.run_id IN (SELECT run_id FROM run_controls WHERE conversation_id = ?)
       OR phases.run_id IN (SELECT run_id FROM run_controls WHERE conversation_id = ?)
  )`;
  database
    .prepare(
      `UPDATE execution_claims SET state = 'revoked'
       WHERE state = 'active' AND attempt_id IN ${attemptScope}`,
    )
    .run(conversationId, conversationId);
  database
    .prepare(
      `UPDATE execution_attempts
       SET state = CASE WHEN state = 'dispatched' THEN 'outcome_unknown' ELSE 'cancelled' END
       WHERE state IN ('ready','claimed','dispatched') AND attempt_id IN ${attemptScope}`,
    )
    .run(conversationId, conversationId);
  database
    .prepare(
      `UPDATE logical_effects SET state = CASE
         WHEN state = 'dispatching' THEN 'outcome_unknown' ELSE 'closed' END
       WHERE state IN ('authorized','dispatching') AND member_id IN (
         SELECT members.member_id FROM wait_group_members members
         JOIN wait_groups groups USING(wait_group_id)
         JOIN run_controls runs ON runs.run_id = groups.run_id
         WHERE runs.conversation_id = ?
       )`,
    )
    .run(conversationId);
  database
    .prepare(
      `UPDATE exact_call_authorizations SET state = 'revoked'
       WHERE state = 'active' AND member_id IN (
         SELECT members.member_id FROM wait_group_members members
         JOIN wait_groups groups USING(wait_group_id)
         JOIN run_controls runs ON runs.run_id = groups.run_id
         WHERE runs.conversation_id = ?
       )`,
    )
    .run(conversationId);
}

function planArtifactDeletion(
  database: DatabaseSync,
  conversationId: string,
  now: string,
): void {
  database
    .prepare(
      `INSERT OR IGNORE INTO artifact_deletion_work (
         work_id, conversation_id, preparation_id, relative_locator,
         expected_digest, expected_byte_length, state, attempt_count,
         last_error, created_at_ms, updated_at_ms
       )
       SELECT 'artifact_delete_' || artifact_id, ?, preparation_id,
              relative_locator, digest, byte_length, 'planned', 0, NULL, ?, ?
       FROM artifact_preparations
       WHERE owner_kind = 'conversation' AND owner_id = ?`,
    )
    .run(conversationId, Date.parse(now), Date.parse(now), conversationId);
}

function redactStage(
  database: DatabaseSync,
  conversationId: string,
  stage: PayloadStage,
  limit: number,
  now: string,
): number {
  const redacted = encode({ redacted: true });
  if (stage === "entries") {
    return Number(
      database
        .prepare(
          `UPDATE conversation_entries
           SET inline_content_json = NULL, provenance_json = ?
           WHERE entry_id IN (
             SELECT entry_id FROM conversation_entries
             WHERE conversation_id = ? AND (
               inline_content_json IS NOT NULL OR provenance_json <> ?
             ) ORDER BY entry_id LIMIT ?
           )`,
        )
        .run(redacted, conversationId, redacted, limit).changes,
    );
  }
  if (stage === "receipts") {
    return Number(
      database
        .prepare(
          `UPDATE command_receipts
           SET content_redacted_at_ms = ?
           WHERE rowid IN (
             SELECT rowid FROM command_receipts
             WHERE owner_kind = 'conversation' AND owner_id = ?
               AND content_redacted_at_ms IS NULL
             ORDER BY rowid LIMIT ?
           )`,
        )
        .run(Date.parse(now), conversationId, limit).changes,
    );
  }
  if (stage === "manifests") {
    const data = encode({ redacted: true });
    return Number(
      database
        .prepare(
          `UPDATE artifact_manifests
           SET data = ?, digest = ?, byte_length = ?
           WHERE manifest_id IN (
             SELECT manifest_id FROM artifact_manifests
             WHERE manifest_id IN (
               SELECT artifact_manifest_id FROM conversation_entries
               WHERE conversation_id = ? AND artifact_manifest_id IS NOT NULL
               UNION
               SELECT source_manifest_id FROM context_boundaries
               WHERE conversation_id = ?
               UNION
               SELECT snapshots.manifest_id FROM execution_snapshots snapshots
               JOIN run_controls runs USING(run_id)
               WHERE runs.conversation_id = ?
               UNION
               SELECT snapshots.opaque_provider_state_manifest_id
               FROM execution_snapshots snapshots JOIN run_controls runs USING(run_id)
               WHERE runs.conversation_id = ?
               UNION
               SELECT phases.request_manifest_id FROM provider_phases phases
               JOIN run_controls runs USING(run_id)
               WHERE runs.conversation_id = ?
               UNION
               SELECT phases.opaque_state_manifest_id FROM provider_phases phases
               JOIN run_controls runs USING(run_id)
               WHERE runs.conversation_id = ?
               UNION
               SELECT pending_manifest_id FROM checkpoints
               WHERE conversation_id = ?
               UNION
               SELECT groups.membership_manifest_id FROM wait_groups groups
               JOIN run_controls runs USING(run_id)
               WHERE runs.conversation_id = ?
               UNION
               SELECT manifest_id FROM artifact_preparations
               WHERE owner_kind = 'conversation' AND owner_id = ?
             ) AND data <> ? ORDER BY manifest_id LIMIT ?
           )`,
        )
        .run(
          data,
          digest(data),
          data.byteLength,
          conversationId,
          conversationId,
          conversationId,
          conversationId,
          conversationId,
          conversationId,
          conversationId,
          conversationId,
          conversationId,
          data,
          limit,
        ).changes,
    );
  }
  return Number(
    database
      .prepare(
        `UPDATE artifact_preparations SET lease_state = 'expired'
         WHERE preparation_id IN (
           SELECT preparation_id FROM artifact_preparations
           WHERE owner_kind = 'conversation' AND owner_id = ?
             AND lease_state <> 'expired'
           ORDER BY preparation_id LIMIT ?
         )`,
      )
      .run(conversationId, limit).changes,
  );
}

function digest(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function assertDeletionUncertaintyResolved(
  database: DatabaseSync,
  intent: DeletionIntent,
): void {
  if (intent.uncertaintyAcknowledged) return;
  const row = database
    .prepare(
      `SELECT EXISTS(
         SELECT 1 FROM logical_effects effects
         JOIN wait_group_members members USING(member_id)
         JOIN wait_groups groups USING(wait_group_id)
         JOIN run_controls runs ON runs.run_id = groups.run_id
         WHERE runs.conversation_id = ?
           AND effects.state IN ('dispatching','outcome_unknown','result_unavailable')
         UNION ALL
         SELECT 1 FROM execution_attempts attempts
         LEFT JOIN provider_phases phases ON phases.phase_id = attempts.provider_phase_id
         LEFT JOIN logical_effects effects ON effects.effect_id = attempts.effect_id
         LEFT JOIN wait_group_members members ON members.member_id = effects.member_id
         LEFT JOIN wait_groups groups ON groups.wait_group_id = members.wait_group_id
         JOIN run_controls runs ON runs.run_id = COALESCE(phases.run_id, groups.run_id)
         WHERE runs.conversation_id = ?
           AND attempts.state IN ('dispatched','outcome_unknown','result_unavailable')
       ) AS uncertain`,
    )
    .get(intent.conversationId, intent.conversationId) as { uncertain: number };
  if (row.uncertain === 1) {
    throw new Error("Deletion has unresolved external execution uncertainty.");
  }
}

function assertNoActiveClaims(
  database: DatabaseSync,
  conversationId: string,
): void {
  const active = database
    .prepare(
      `SELECT 1 FROM execution_claims claims
       JOIN execution_attempts attempts USING(attempt_id)
       LEFT JOIN logical_effects effects USING(effect_id)
       LEFT JOIN wait_group_members members USING(member_id)
       LEFT JOIN wait_groups groups USING(wait_group_id)
       LEFT JOIN provider_phases phases ON phases.phase_id = attempts.provider_phase_id
       LEFT JOIN run_controls runs ON runs.run_id = COALESCE(groups.run_id, phases.run_id)
       WHERE runs.conversation_id = ? AND claims.state = 'active' LIMIT 1`,
    )
    .get(conversationId);
  if (active) throw new Error("Deletion execution settlement is incomplete.");
}

function assertArtifactDeletionSettled(
  database: DatabaseSync,
  conversationId: string,
): void {
  const unresolved = database
    .prepare(
      `SELECT 1 FROM artifact_deletion_work
       WHERE conversation_id = ? AND state NOT IN ('deleted','missing') LIMIT 1`,
    )
    .get(conversationId);
  if (unresolved) throw new Error("Artifact deletion work remains unresolved.");
}

function readIntent(
  database: DatabaseSync,
  conversationId: string,
): DeletionIntent | undefined {
  const row = database
    .prepare(
      `SELECT command_id, fence_revision, phase, cleanup_cursor,
              uncertainty_acknowledged, created_at_ms, updated_at_ms
       FROM deletion_intents WHERE conversation_id = ?`,
    )
    .get(conversationId) as
    | {
        command_id: string;
        fence_revision: number;
        phase: DeletionIntent["phase"];
        cleanup_cursor: string | null;
        uncertainty_acknowledged: number;
        created_at_ms: number;
        updated_at_ms: number;
      }
    | undefined;
  if (!row) return undefined;
  return deletionIntentSchema.parse({
    schemaVersion: 1,
    conversationId,
    commandId: row.command_id,
    fenceRevision: row.fence_revision,
    phase: row.phase,
    cleanupCursor: row.cleanup_cursor ?? undefined,
    uncertaintyAcknowledged: row.uncertainty_acknowledged === 1,
    createdAt: new Date(row.created_at_ms).toISOString(),
    updatedAt: new Date(row.updated_at_ms).toISOString(),
  });
}

function requireIntent(
  database: DatabaseSync,
  conversationId: string,
): DeletionIntent {
  const intent = readIntent(database, conversationId);
  if (!intent)
    throw new Error(`Deletion intent for '${conversationId}' was not found.`);
  return intent;
}

function updateIntent(
  database: DatabaseSync,
  current: DeletionIntent,
  phase: DeletionIntent["phase"],
  cursor: string | undefined,
  now: string,
): void {
  const changed = database
    .prepare(
      `UPDATE deletion_intents SET phase = ?, cleanup_cursor = ?, updated_at_ms = ?
       WHERE conversation_id = ? AND command_id = ? AND fence_revision = ? AND phase = ?`,
    )
    .run(
      phase,
      cursor ?? null,
      Date.parse(now),
      current.conversationId,
      current.commandId,
      current.fenceRevision,
      current.phase,
    );
  if (changed.changes !== 1)
    throw new Error("Deletion cleanup phase conflict.");
}

function readArtifactWork(
  database: DatabaseSync,
  workId: string,
): ArtifactDeletionWork | undefined {
  const row = database
    .prepare(`SELECT * FROM artifact_deletion_work WHERE work_id = ?`)
    .get(workId) as Record<string, unknown> | undefined;
  if (!row) return undefined;
  return artifactDeletionWorkSchema.parse({
    schemaVersion: 1,
    workId: row.work_id,
    conversationId: row.conversation_id,
    preparationId: row.preparation_id,
    relativeLocator: row.relative_locator,
    expectedDigest: row.expected_digest,
    expectedByteLength: row.expected_byte_length,
    state: row.state,
    attemptCount: row.attempt_count,
    lastError: row.last_error ?? undefined,
    createdAt: new Date(row.created_at_ms as number).toISOString(),
    updatedAt: new Date(row.updated_at_ms as number).toISOString(),
  });
}

function parsePayloadStage(cursor: string | undefined): PayloadStage {
  return payloadStages.includes(cursor as PayloadStage)
    ? (cursor as PayloadStage)
    : "entries";
}

function inImmediateTransaction<T>(database: DatabaseSync, action: () => T): T {
  database.exec("BEGIN IMMEDIATE");
  try {
    const result = action();
    database.exec("COMMIT");
    return result;
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}
