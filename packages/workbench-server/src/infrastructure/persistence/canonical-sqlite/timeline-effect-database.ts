import type { DatabaseSync } from "node:sqlite";
import type {
  CanonicalExecutionAttempt,
  ExactCallAuthorization,
  ExecutionClaim,
  LogicalEffect,
  RecoveryAction,
} from "@nervekit/contracts/runs";
import { decode, encode } from "./payload-codecs.js";

const legalEffectTransitions: Readonly<Record<string, readonly string[]>> = {
  authorized: ["dispatching", "closed"],
  dispatching: ["settled", "outcome_unknown", "result_unavailable"],
  outcome_unknown: ["settled", "result_unavailable", "closed"],
  result_unavailable: ["settled", "closed"],
  settled: ["closed"],
  closed: [],
};

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
  const existing = database
    .prepare(
      `SELECT member_id, normalized_input_hash, policy_observation_id,
              run_generation, selection_epoch, state
       FROM exact_call_authorizations WHERE authorization_id = ?`,
    )
    .get(authorization.authorizationId) as
    | {
        member_id: string;
        normalized_input_hash: string;
        policy_observation_id: string;
        run_generation: number;
        selection_epoch: number;
        state: ExactCallAuthorization["state"];
      }
    | undefined;
  if (existing) {
    if (
      existing.member_id !== authorization.memberId ||
      existing.normalized_input_hash !==
        authorization.normalizedInputFingerprint ||
      existing.policy_observation_id !== authorization.policyObservationId ||
      existing.run_generation !== authorization.runGeneration ||
      existing.selection_epoch !== authorization.selectionEpoch ||
      existing.state !== "active" ||
      authorization.state === "active"
    ) {
      throw new Error("Authorization identity or state transition is invalid.");
    }
    const changed = database
      .prepare(
        `UPDATE exact_call_authorizations SET state = ?
         WHERE authorization_id = ? AND state = 'active'`,
      )
      .run(authorization.state, authorization.authorizationId);
    if (changed.changes !== 1) throw new Error("Authorization state conflict.");
    return;
  }
  if (authorization.state !== "active") {
    throw new Error("A new authorization must begin active.");
  }
  const evidence = database
    .prepare(
      `SELECT members.input_fingerprint,
              observations.normalized_input_hash AS observed_input_hash,
              runs.generation AS run_generation,
              runs.bound_selection_epoch AS selection_epoch
       FROM wait_group_members members
       JOIN wait_groups groups ON groups.wait_group_id = members.wait_group_id
       JOIN run_controls runs ON runs.run_id = groups.run_id
       JOIN policy_observations observations ON observations.observation_id = ?
       WHERE members.member_id = ?`,
    )
    .get(authorization.policyObservationId, authorization.memberId) as
    | {
        input_fingerprint: string;
        observed_input_hash: string;
        run_generation: number;
        selection_epoch: number;
      }
    | undefined;
  if (
    evidence?.input_fingerprint !== authorization.normalizedInputFingerprint ||
    evidence.observed_input_hash !== authorization.normalizedInputFingerprint ||
    evidence.run_generation !== authorization.runGeneration ||
    evidence.selection_epoch !== authorization.selectionEpoch
  ) {
    throw new Error(
      "Authorization does not match its input, observation, or run fence.",
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
  const existing = database
    .prepare(
      `SELECT member_id, tool_name, capability_version, capability_kind,
              normalized_input_hash, authorization_id, state
       FROM logical_effects WHERE effect_id = ?`,
    )
    .get(effect.effectId) as
    | {
        member_id: string;
        tool_name: string;
        capability_version: number;
        capability_kind: string;
        normalized_input_hash: string;
        authorization_id: string;
        state: LogicalEffect["state"];
      }
    | undefined;
  if (existing) {
    if (
      existing.member_id !== effect.memberId ||
      existing.tool_name !== effect.toolName ||
      existing.capability_version !== effect.capability.version ||
      existing.capability_kind !== effect.capability.kind ||
      existing.normalized_input_hash !== effect.normalizedInputFingerprint ||
      existing.authorization_id !== effect.authorizationId ||
      !legalEffectTransitions[existing.state]?.includes(effect.state)
    ) {
      throw new Error(
        "Logical effect identity or state transition is invalid.",
      );
    }
    const changed = database
      .prepare(
        `UPDATE logical_effects SET state = ?
         WHERE effect_id = ? AND state = ?`,
      )
      .run(effect.state, effect.effectId, existing.state);
    if (changed.changes !== 1)
      throw new Error("Logical effect state conflict.");
    return;
  }
  if (effect.state !== "authorized") {
    throw new Error("A new logical effect must begin authorized.");
  }
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
  const current = readTimelineExecutionAttempt(database, attempt.attemptId);
  if (
    [
      "claimed",
      "dispatched",
      "succeeded",
      "known_failed",
      "result_unavailable",
    ].includes(attempt.state)
  ) {
    assertDispatchAdmitted(database, attempt.executionIncarnationId);
  }
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
  if (claim.state === "active") {
    assertDispatchAdmitted(database, claim.executionIncarnationId);
  }
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
    const attempt = readTimelineExecutionAttempt(database, claim.attemptId);
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
  const attempt = readTimelineExecutionAttempt(database, claim.attemptId);
  const owner = database
    .prepare(
      `SELECT COALESCE(effect_owner.deletion_state, provider_owner.deletion_state)
                AS deletion_state
       FROM execution_attempts attempts
       LEFT JOIN logical_effects effects ON effects.effect_id = attempts.effect_id
       LEFT JOIN wait_group_members members ON members.member_id = effects.member_id
       LEFT JOIN wait_groups groups ON groups.wait_group_id = members.wait_group_id
       LEFT JOIN run_controls effect_run ON effect_run.run_id = groups.run_id
       LEFT JOIN conversations effect_owner
         ON effect_owner.conversation_id = effect_run.conversation_id
       LEFT JOIN provider_phases phases ON phases.phase_id = attempts.provider_phase_id
       LEFT JOIN run_controls provider_run ON provider_run.run_id = phases.run_id
       LEFT JOIN conversations provider_owner
         ON provider_owner.conversation_id = provider_run.conversation_id
       WHERE attempts.attempt_id = ?`,
    )
    .get(claim.attemptId) as { deletion_state: string | null } | undefined;
  if (
    claim.state !== "active" ||
    owner?.deletion_state !== "active" ||
    attempt?.state !== "claimed" ||
    Date.parse(claim.leaseDeadline) <= Date.parse(now)
  ) {
    throw new Error(
      "An active claim requires an unfenced owner, claimed attempt, and live lease.",
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

function assertDispatchAdmitted(
  database: DatabaseSync,
  incarnationId: string,
): void {
  const row = database
    .prepare(
      `SELECT execution_incarnation_id, dispatch_state
       FROM runtime_admission WHERE singleton = 1`,
    )
    .get() as
    | { execution_incarnation_id: string; dispatch_state: string }
    | undefined;
  if (
    row?.execution_incarnation_id !== incarnationId ||
    row.dispatch_state !== "admitted"
  ) {
    throw new Error("Execution dispatch is not admitted for this incarnation.");
  }
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

export function listTimelineExecutionAttemptsForProviderPhase(
  database: DatabaseSync,
  phaseId: string,
): CanonicalExecutionAttempt[] {
  const rows = database
    .prepare(
      `SELECT attempt_id FROM execution_attempts
       WHERE provider_phase_id = ? ORDER BY attempt_number`,
    )
    .all(phaseId) as unknown as Array<{ attempt_id: string }>;
  return rows
    .map((row) => readTimelineExecutionAttempt(database, row.attempt_id))
    .filter((attempt): attempt is CanonicalExecutionAttempt =>
      Boolean(attempt),
    );
}

export function listTimelineExecutionClaimsForAttempts(
  database: DatabaseSync,
  attemptIds: readonly string[],
): ExecutionClaim[] {
  const claims: ExecutionClaim[] = [];
  const statement = database.prepare(
    `SELECT claim_id FROM execution_claims
     WHERE attempt_id = ? ORDER BY generation, claim_id`,
  );
  for (const attemptId of attemptIds) {
    const rows = statement.all(attemptId) as unknown as Array<{
      claim_id: string;
    }>;
    for (const row of rows) {
      const claim = readTimelineExecutionClaim(database, row.claim_id);
      if (claim) claims.push(claim);
    }
  }
  return claims;
}

export function readTimelineExecutionClaim(
  database: DatabaseSync,
  claimId: string,
): ExecutionClaim | undefined {
  const row = database
    .prepare(
      `SELECT attempt_id, token, generation, incarnation_id, lease_deadline_ms,
              state FROM execution_claims WHERE claim_id = ?`,
    )
    .get(claimId) as
    | {
        attempt_id: string;
        token: string;
        generation: number;
        incarnation_id: string;
        lease_deadline_ms: number;
        state: ExecutionClaim["state"];
      }
    | undefined;
  return row
    ? {
        schemaVersion: 1,
        claimId,
        attemptId: row.attempt_id,
        token: row.token,
        generation: row.generation,
        executionIncarnationId: row.incarnation_id,
        leaseDeadline: new Date(row.lease_deadline_ms).toISOString(),
        state: row.state,
      }
    : undefined;
}

export function readTimelineExecutionAttempt(
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
