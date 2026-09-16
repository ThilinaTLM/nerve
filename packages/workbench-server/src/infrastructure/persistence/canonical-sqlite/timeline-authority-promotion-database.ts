import type { DatabaseSync } from "node:sqlite";
import {
  timelineAuthorityPromotionSchema,
  type TimelineAuthorityPromotion,
} from "@nervekit/contracts/storage";
import { readTimelineStateIdentity } from "./timeline-query-database.js";
import { readTimelineRuntimeAdmission } from "./timeline-query-database.js";
import { withTimelineImmediateTransaction } from "./timeline-transaction.js";

export function promoteTimelineRuntimeAdmission(
  database: DatabaseSync,
  promotion: TimelineAuthorityPromotion,
): TimelineAuthorityPromotion {
  const parsed = timelineAuthorityPromotionSchema.parse(promotion);
  return withTimelineImmediateTransaction(database, () => {
    const identity = readTimelineStateIdentity(database);
    const admission = readTimelineRuntimeAdmission(database);
    if (
      !identity ||
      !admission ||
      identity.namespaceId !== parsed.namespaceId ||
      identity.executionIncarnationId !== parsed.priorExecutionIncarnationId ||
      admission.executionIncarnationId !== parsed.priorExecutionIncarnationId ||
      admission.dispatchState !== "disabled"
    ) {
      throw new Error("Timeline promotion source authority is not fenced.");
    }
    const unsafe = database
      .prepare(
        `SELECT
           EXISTS(SELECT 1 FROM run_controls WHERE foreground_owned = 1) AS foreground,
           EXISTS(SELECT 1 FROM execution_claims WHERE state = 'active') AS claims,
           EXISTS(SELECT 1 FROM execution_attempts
                  WHERE state IN ('claimed','dispatched')) AS attempts,
           EXISTS(SELECT 1 FROM provider_phases
                  WHERE state IN ('active','response_prepared')) AS providers,
           EXISTS(SELECT 1 FROM conversation_records) AS legacy_records,
           EXISTS(SELECT 1 FROM lifecycle_work) AS legacy_work,
           EXISTS(SELECT 1 FROM run_lifecycle_records) AS legacy_runs,
           EXISTS(SELECT 1 FROM lifecycle_tool_proposals) AS legacy_proposals,
           EXISTS(SELECT 1 FROM lifecycle_interactions) AS legacy_interactions,
           EXISTS(SELECT 1 FROM lifecycle_execution_attempts) AS legacy_attempts,
           EXISTS(SELECT 1 FROM lifecycle_recovery_issues) AS legacy_recovery,
           EXISTS(SELECT 1 FROM reconciliation_operations) AS legacy_reconciliation`,
      )
      .get() as {
      foreground: number;
      claims: number;
      attempts: number;
      providers: number;
      legacy_records: number;
      legacy_work: number;
      legacy_runs: number;
      legacy_proposals: number;
      legacy_interactions: number;
      legacy_attempts: number;
      legacy_recovery: number;
      legacy_reconciliation: number;
    };
    if (
      unsafe.foreground ||
      unsafe.claims ||
      unsafe.attempts ||
      unsafe.providers ||
      unsafe.legacy_records ||
      unsafe.legacy_work ||
      unsafe.legacy_runs ||
      unsafe.legacy_proposals ||
      unsafe.legacy_interactions ||
      unsafe.legacy_attempts ||
      unsafe.legacy_recovery ||
      unsafe.legacy_reconciliation
    ) {
      throw new Error("Timeline promotion has unresolved execution authority.");
    }
    database
      .prepare(
        `INSERT INTO timeline_authority_promotions (
           promotion_id, namespace_id, prior_incarnation_id, incarnation_id,
           proof_digest, old_runtime_isolated, state, promoted_at_ms
         ) VALUES (?, ?, ?, ?, ?, 1, 'promoted', ?)`,
      )
      .run(
        parsed.promotionId,
        parsed.namespaceId,
        parsed.priorExecutionIncarnationId,
        parsed.executionIncarnationId,
        parsed.proofDigest,
        Date.parse(parsed.promotedAt),
      );
    const identityUpdate = database
      .prepare(
        `UPDATE state_identity
         SET execution_incarnation_id = ?, promoted_at_ms = ?
         WHERE singleton = 1 AND execution_incarnation_id = ?`,
      )
      .run(
        parsed.executionIncarnationId,
        Date.parse(parsed.promotedAt),
        parsed.priorExecutionIncarnationId,
      );
    const admissionUpdate = database
      .prepare(
        `UPDATE runtime_admission
         SET execution_incarnation_id = ?, dispatch_state = 'admitted',
             restore_id = NULL, updated_at_ms = ?
         WHERE singleton = 1 AND execution_incarnation_id = ?
           AND dispatch_state = 'disabled'`,
      )
      .run(
        parsed.executionIncarnationId,
        Date.parse(parsed.promotedAt),
        parsed.priorExecutionIncarnationId,
      );
    if (identityUpdate.changes !== 1 || admissionUpdate.changes !== 1) {
      throw new Error("Timeline promotion authority changed during commit.");
    }
    return parsed;
  });
}
