import type { DatabaseSync } from "node:sqlite";
import type {
  CanonicalExecutionAttempt,
  ExactCallAuthorization,
  ExecutionClaim,
  LogicalEffect,
  RecoveryAction,
} from "@nervekit/contracts/runs";
import { decode, encode } from "./payload-codecs.js";

const legalAttemptTransitions: Readonly<Record<string, readonly string[]>> = {
  ready: ["claimed", "cancelled"],
  claimed: ["dispatched", "cancelled", "outcome_unknown"],
  dispatched: [
    "succeeded",
    "known_failed",
    "cancelled",
    "outcome_unknown",
    "result_unavailable",
  ],
  outcome_unknown: [
    "claimed",
    "succeeded",
    "known_failed",
    "cancelled",
    "result_unavailable",
  ],
  result_unavailable: ["claimed", "succeeded", "known_failed", "cancelled"],
  succeeded: [],
  known_failed: [],
  cancelled: [],
};

export function insertTimelineAuthorization(
  database: DatabaseSync,
  authorization: ExactCallAuthorization,
): void {
  const member = database
    .prepare(
      `SELECT input_fingerprint FROM wait_group_members WHERE member_id = ?`,
    )
    .get(authorization.memberId) as { input_fingerprint: string } | undefined;
  if (member?.input_fingerprint !== authorization.normalizedInputFingerprint) {
    throw new Error(
      "Authorization input does not match its wait-group member.",
    );
  }
  database
    .prepare(
      `INSERT INTO exact_call_authorizations (
         authorization_id, member_id, normalized_input_hash,
         policy_observation_id, run_generation, selection_epoch, state,
         data, created_at_ms
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      authorization.authorizationId,
      authorization.memberId,
      authorization.normalizedInputFingerprint,
      authorization.policyObservationId,
      authorization.runGeneration,
      authorization.selectionEpoch,
      authorization.state,
      encode(authorization.evidence),
      Date.parse(authorization.createdAt),
    );
}

export function insertTimelineLogicalEffect(
  database: DatabaseSync,
  effect: LogicalEffect,
): void {
  const authorization = database
    .prepare(
      `SELECT member_id, normalized_input_hash FROM exact_call_authorizations
       WHERE authorization_id = ?`,
    )
    .get(effect.authorizationId) as
    | { member_id: string; normalized_input_hash: string }
    | undefined;
  if (
    authorization?.member_id !== effect.memberId ||
    authorization.normalized_input_hash !== effect.normalizedInputFingerprint
  ) {
    throw new Error("Logical effect does not match its exact authorization.");
  }
  database
    .prepare(
      `INSERT INTO logical_effects (
         effect_id, member_id, tool_name, capability_version,
         capability_kind, normalized_input_hash, owner_json,
         external_scope_json, external_key, authorization_id, state,
         created_at_ms
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      effect.effectId,
      effect.memberId,
      effect.toolName,
      effect.capability.version,
      effect.capability.kind,
      effect.normalizedInputFingerprint,
      encode(effect.owner),
      effect.externalScope ? encode(effect.externalScope) : null,
      effect.externalKey ?? null,
      effect.authorizationId,
      effect.state,
      Date.parse(effect.createdAt),
    );
}

export function persistTimelineExecutionAttempt(
  database: DatabaseSync,
  attempt: CanonicalExecutionAttempt,
): void {
  assertCurrentIncarnation(database, attempt.executionIncarnationId);
  const current = readAttempt(database, attempt.attemptId);
  if (current) {
    if (
      current.effectId !== attempt.effectId ||
      current.providerPhaseId !== attempt.providerPhaseId ||
      current.attemptNumber !== attempt.attemptNumber ||
      current.executionIncarnationId !== attempt.executionIncarnationId ||
      !legalAttemptTransitions[current.state]?.includes(attempt.state)
    ) {
      throw new Error(
        "Execution attempt identity or state transition is invalid.",
      );
    }
    const changed = database
      .prepare(
        `UPDATE execution_attempts SET state = ?, outcome_json = ?,
           prepared_manifest_id = ?, external_locator = ?, updated_at_ms = ?
         WHERE attempt_id = ? AND state = ?`,
      )
      .run(
        attempt.state,
        attempt.outcome === undefined ? null : encode(attempt.outcome),
        attempt.preparedManifestId ?? null,
        attempt.externalLocator ?? null,
        Date.parse(attempt.updatedAt),
        attempt.attemptId,
        current.state,
      );
    if (changed.changes !== 1) {
      throw new Error(`Execution attempt ${attempt.attemptId} state conflict.`);
    }
    return;
  }
  if (attempt.state !== "ready") {
    throw new Error("A new execution attempt must begin ready.");
  }
  database
    .prepare(
      `INSERT INTO execution_attempts (
         attempt_id, effect_id, provider_phase_id, attempt_number,
         incarnation_id, state, outcome_json, prepared_manifest_id,
         external_locator, created_at_ms, updated_at_ms
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      attempt.attemptId,
      attempt.effectId ?? null,
      attempt.providerPhaseId ?? null,
      attempt.attemptNumber,
      attempt.executionIncarnationId,
      attempt.state,
      attempt.outcome === undefined ? null : encode(attempt.outcome),
      attempt.preparedManifestId ?? null,
      attempt.externalLocator ?? null,
      Date.parse(attempt.createdAt),
      Date.parse(attempt.updatedAt),
    );
}

export function persistTimelineExecutionClaim(
  database: DatabaseSync,
  claim: ExecutionClaim,
  now: string,
): void {
  assertCurrentIncarnation(database, claim.executionIncarnationId);
  const current = database
    .prepare(
      `SELECT attempt_id, token, generation, incarnation_id, state
       FROM execution_claims WHERE claim_id = ?`,
    )
    .get(claim.claimId) as
    | {
        attempt_id: string;
        token: string;
        generation: number;
        incarnation_id: string;
        state: ExecutionClaim["state"];
      }
    | undefined;
  if (current) {
    const attempt = readAttempt(database, claim.attemptId);
    const terminalAttempt =
      attempt &&
      [
        "succeeded",
        "known_failed",
        "cancelled",
        "outcome_unknown",
        "result_unavailable",
      ].includes(attempt.state);
    if (
      current.attempt_id !== claim.attemptId ||
      current.token !== claim.token ||
      current.generation !== claim.generation ||
      current.incarnation_id !== claim.executionIncarnationId ||
      current.state !== "active" ||
      claim.state === "active" ||
      !terminalAttempt
    ) {
      throw new Error(
        "Execution claim identity or state transition is invalid.",
      );
    }
    const changed = database
      .prepare(
        `UPDATE execution_claims SET state = ?, lease_deadline_ms = ?
         WHERE claim_id = ? AND state = 'active' AND token = ?`,
      )
      .run(
        claim.state,
        Date.parse(claim.leaseDeadline),
        claim.claimId,
        claim.token,
      );
    if (changed.changes !== 1) throw new Error("Execution claim conflict.");
    return;
  }
  const attempt = readAttempt(database, claim.attemptId);
  if (
    claim.state !== "active" ||
    attempt?.state !== "claimed" ||
    Date.parse(claim.leaseDeadline) <= Date.parse(now)
  ) {
    throw new Error(
      "An active claim requires a claimed attempt and live lease.",
    );
  }
  database
    .prepare(
      `INSERT INTO execution_claims (
         claim_id, attempt_id, token, generation, incarnation_id,
         lease_deadline_ms, state
       ) VALUES (?, ?, ?, ?, ?, ?, 'active')`,
    )
    .run(
      claim.claimId,
      claim.attemptId,
      claim.token,
      claim.generation,
      claim.executionIncarnationId,
      Date.parse(claim.leaseDeadline),
    );
}

export function validateTimelineAttemptClaims(
  database: DatabaseSync,
  attemptIds: readonly string[],
): void {
  const statement = database.prepare(
    `SELECT attempts.attempt_id, attempts.state,
            COUNT(claims.claim_id) AS active_claims
     FROM execution_attempts attempts
     LEFT JOIN execution_claims claims
       ON claims.attempt_id = attempts.attempt_id AND claims.state = 'active'
     WHERE attempts.attempt_id = ?
     GROUP BY attempts.attempt_id, attempts.state`,
  );
  for (const attemptId of new Set(attemptIds)) {
    const row = statement.get(attemptId) as
      | { attempt_id: string; state: string; active_claims: number }
      | undefined;
    const expectsClaim =
      row?.state === "claimed" || row?.state === "dispatched";
    if (!row || row.active_claims !== (expectsClaim ? 1 : 0)) {
      throw new Error(
        `Execution attempt ${attemptId} has inconsistent claim ownership.`,
      );
    }
  }
}

export function insertTimelineRecoveryAction(
  database: DatabaseSync,
  action: RecoveryAction,
): void {
  database
    .prepare(
      `INSERT INTO recovery_actions (
         action_id, conversation_id, run_id, member_id, effect_id,
         action_kind, evidence_json, evidence_manifest_id, status,
         command_id, created_at_ms
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      action.actionId,
      action.conversationId,
      action.runId ?? null,
      action.memberId ?? null,
      action.effectId ?? null,
      action.actionKind,
      encode(action.evidence),
      action.evidenceManifestId ?? null,
      action.status,
      action.commandId,
      Date.parse(action.createdAt),
    );
}

function assertCurrentIncarnation(
  database: DatabaseSync,
  incarnationId: string,
): void {
  const row = database
    .prepare(
      `SELECT execution_incarnation_id FROM state_identity WHERE singleton = 1`,
    )
    .get() as { execution_incarnation_id: string } | undefined;
  if (row?.execution_incarnation_id !== incarnationId) {
    throw new Error("Execution incarnation is stale.");
  }
}

function readAttempt(
  database: DatabaseSync,
  attemptId: string,
): CanonicalExecutionAttempt | undefined {
  const row = database
    .prepare(
      `SELECT effect_id, provider_phase_id, attempt_number, incarnation_id,
              state, outcome_json, prepared_manifest_id, external_locator,
              created_at_ms, updated_at_ms
       FROM execution_attempts WHERE attempt_id = ?`,
    )
    .get(attemptId) as
    | {
        effect_id: string | null;
        provider_phase_id: string | null;
        attempt_number: number;
        incarnation_id: string;
        state: CanonicalExecutionAttempt["state"];
        outcome_json: Uint8Array | null;
        prepared_manifest_id: string | null;
        external_locator: string | null;
        created_at_ms: number;
        updated_at_ms: number;
      }
    | undefined;
  if (!row) return undefined;
  return {
    schemaVersion: 1,
    attemptId,
    ...(row.effect_id ? { effectId: row.effect_id } : {}),
    ...(row.provider_phase_id
      ? { providerPhaseId: row.provider_phase_id }
      : {}),
    attemptNumber: row.attempt_number,
    executionIncarnationId: row.incarnation_id,
    state: row.state,
    ...(row.outcome_json ? { outcome: decode(row.outcome_json) } : {}),
    ...(row.prepared_manifest_id
      ? { preparedManifestId: row.prepared_manifest_id }
      : {}),
    ...(row.external_locator ? { externalLocator: row.external_locator } : {}),
    createdAt: new Date(row.created_at_ms).toISOString(),
    updatedAt: new Date(row.updated_at_ms).toISOString(),
  };
}
