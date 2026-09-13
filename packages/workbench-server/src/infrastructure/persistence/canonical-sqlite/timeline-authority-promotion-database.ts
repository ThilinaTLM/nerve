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
           EXISTS(SELECT 1 FROM conversation_records) AS legacy_records`,
      )
      .get() as {
      foreground: number;
      claims: number;
      attempts: number;
      providers: number;
      legacy_records: number;
    };
    if (
      unsafe.foreground ||
      unsafe.claims ||
      unsafe.attempts ||
      unsafe.providers ||
      unsafe.legacy_records
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
