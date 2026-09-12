import type { DatabaseSync } from "node:sqlite";
import type {
  PolicyDiagnostic,
  PolicyDocumentObservation,
  PolicyFallbackDecision,
  PolicySaveIntent,
} from "@nervekit/contracts/permissions";
import { encode } from "./payload-codecs.js";

const diagnosticTerminalStates = new Set([
  "repaired",
  "reset",
  "fallback_selected",
]);

const saveTransitions: Readonly<Record<string, readonly string[]>> = {
  recorded: ["writing", "conflicted"],
  writing: ["saved_pending_finalization", "save_failed", "conflicted"],
  saved_pending_finalization: ["finalized", "finalization_superseded"],
  save_failed: [],
  conflicted: [],
  finalized: [],
  finalization_superseded: [],
};

export function insertTimelinePolicyObservation(
  database: DatabaseSync,
  observation: PolicyDocumentObservation,
): void {
  database
    .prepare(
      `INSERT INTO policy_observations (
         observation_id, scope_json, document_identity, complete_digest,
         rule_set_id, rule_set_digest, overlay_digests_json,
         normalized_input_hash, trust_evidence_json, observed_at_ms
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      observation.observationId,
      encode(observation.scope),
      observation.documentIdentity,
      observation.completeDocumentDigest,
      observation.selectedRuleSetId,
      observation.selectedRuleSetDigest,
      encode(observation.applicableOverlayDigests),
      observation.normalizedInputFingerprint,
      encode(observation.trustEvidence),
      Date.parse(observation.observedAt),
    );
}

export function persistTimelinePolicyDiagnostic(
  database: DatabaseSync,
  diagnostic: PolicyDiagnostic,
): void {
  const current = database
    .prepare(
      `SELECT scope_json, document_identity, failure_fingerprint, failure_kind,
              affected_member_ids_json, state
       FROM policy_diagnostics WHERE diagnostic_id = ?`,
    )
    .get(diagnostic.diagnosticId) as
    | {
        scope_json: Uint8Array;
        document_identity: string;
        failure_fingerprint: string;
        failure_kind: string;
        affected_member_ids_json: Uint8Array;
        state: PolicyDiagnostic["state"];
      }
    | undefined;
  if (current) {
    const immutableMatches =
      Buffer.from(current.scope_json).equals(
        Buffer.from(encode(diagnostic.scope)),
      ) &&
      current.document_identity === diagnostic.documentIdentity &&
      current.failure_fingerprint === diagnostic.failureFingerprint &&
      current.failure_kind === diagnostic.failureKind &&
      Buffer.from(current.affected_member_ids_json).equals(
        Buffer.from(encode(diagnostic.affectedMemberIds)),
      );
    if (
      !immutableMatches ||
      current.state !== "unresolved" ||
      !diagnosticTerminalStates.has(diagnostic.state) ||
      !diagnostic.resolvedAt
    ) {
      throw new Error(
        "Policy diagnostic identity or state transition is invalid.",
      );
    }
    const changed = database
      .prepare(
        `UPDATE policy_diagnostics SET state = ?, resolved_at_ms = ?
         WHERE diagnostic_id = ? AND state = 'unresolved'`,
      )
      .run(
        diagnostic.state,
        Date.parse(diagnostic.resolvedAt),
        diagnostic.diagnosticId,
      );
    if (changed.changes !== 1) throw new Error("Policy diagnostic conflict.");
    return;
  }
  if (diagnostic.state !== "unresolved" || diagnostic.resolvedAt) {
    throw new Error("A new policy diagnostic must begin unresolved.");
  }
  database
    .prepare(
      `INSERT INTO policy_diagnostics (
         diagnostic_id, scope_json, document_identity, failure_fingerprint,
         failure_kind, affected_member_ids_json, state, observed_at_ms,
         resolved_at_ms
       ) VALUES (?, ?, ?, ?, ?, ?, 'unresolved', ?, NULL)`,
    )
    .run(
      diagnostic.diagnosticId,
      encode(diagnostic.scope),
      diagnostic.documentIdentity,
      diagnostic.failureFingerprint,
      diagnostic.failureKind,
      encode(diagnostic.affectedMemberIds),
      Date.parse(diagnostic.observedAt),
    );
}

export function insertTimelinePolicyFallbackDecision(
  database: DatabaseSync,
  decision: PolicyFallbackDecision,
): void {
  const diagnostic = database
    .prepare(`SELECT state FROM policy_diagnostics WHERE diagnostic_id = ?`)
    .get(decision.diagnosticId) as { state: string } | undefined;
  if (diagnostic?.state !== "fallback_selected") {
    throw new Error("Baseline fallback requires its resolved diagnostic.");
  }
  database
    .prepare(
      `INSERT INTO policy_decisions (
         decision_id, diagnostic_id, requested_rule_set_id,
         effective_rule_set_id, overlays_enabled, confirmation_fingerprint,
         state, decided_at_ms
       ) VALUES (?, ?, ?, 'baseline', 0, ?, ?, ?)`,
    )
    .run(
      decision.decisionId,
      decision.diagnosticId,
      decision.requestedRuleSetId,
      decision.confirmationFingerprint,
      decision.state,
      Date.parse(decision.decidedAt),
    );
}

export function persistTimelinePolicySaveIntent(
  database: DatabaseSync,
  intent: PolicySaveIntent,
): void {
  const current = database
    .prepare(
      `SELECT command_id, scope_json, document_identity, observed_digest,
              intended_digest, rule_fingerprint, state
       FROM policy_save_intents WHERE save_intent_id = ?`,
    )
    .get(intent.saveIntentId) as
    | {
        command_id: string;
        scope_json: Uint8Array;
        document_identity: string;
        observed_digest: string | null;
        intended_digest: string;
        rule_fingerprint: string;
        state: PolicySaveIntent["state"];
      }
    | undefined;
  if (current) {
    if (
      current.command_id !== intent.commandId ||
      !Buffer.from(current.scope_json).equals(
        Buffer.from(encode(intent.scope)),
      ) ||
      current.document_identity !== intent.documentIdentity ||
      current.observed_digest !== (intent.observedDocumentDigest ?? null) ||
      current.intended_digest !== intent.intendedDocumentDigest ||
      current.rule_fingerprint !== intent.ruleFingerprint ||
      !saveTransitions[current.state]?.includes(intent.state)
    ) {
      throw new Error(
        "Policy save intent identity or state transition is invalid.",
      );
    }
    const changed = database
      .prepare(
        `UPDATE policy_save_intents
         SET state = ?, file_outcome = ?, approval_outcome = ?, updated_at_ms = ?
         WHERE save_intent_id = ? AND state = ?`,
      )
      .run(
        intent.state,
        intent.fileOutcome,
        intent.approvalOutcome,
        Date.parse(intent.updatedAt),
        intent.saveIntentId,
        current.state,
      );
    if (changed.changes !== 1) throw new Error("Policy save intent conflict.");
    return;
  }
  if (
    intent.state !== "recorded" ||
    intent.fileOutcome !== "not_attempted" ||
    intent.approvalOutcome !== "not_attempted"
  ) {
    throw new Error("A new policy save intent must begin recorded.");
  }
  database
    .prepare(
      `INSERT INTO policy_save_intents (
         save_intent_id, scope_json, command_id, document_identity,
         observed_digest, intended_digest, rule_fingerprint, state,
         file_outcome, approval_outcome, created_at_ms, updated_at_ms
       ) VALUES (?, ?, ?, ?, ?, ?, ?, 'recorded', 'not_attempted',
                 'not_attempted', ?, ?)`,
    )
    .run(
      intent.saveIntentId,
      encode(intent.scope),
      intent.commandId,
      intent.documentIdentity,
      intent.observedDocumentDigest ?? null,
      intent.intendedDocumentDigest,
      intent.ruleFingerprint,
      Date.parse(intent.createdAt),
      Date.parse(intent.updatedAt),
    );
}
