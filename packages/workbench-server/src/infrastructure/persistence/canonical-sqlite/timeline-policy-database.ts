import type { DatabaseSync } from "node:sqlite";
import type {
  PolicyDiagnostic,
  PolicyDocumentObservation,
  PolicyFallbackDecision,
  PolicySaveIntent,
} from "@nervekit/contracts/permissions";
import { policySaveIntentSchema } from "@nervekit/contracts/permissions";
import { decode, encode } from "./payload-codecs.js";

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

interface PolicySaveIntentRow {
  schema_version: number;
  save_intent_id: string;
  command_id: string;
  scope_json: Uint8Array;
  document_identity: string;
  observed_digest: string | null;
  intended_digest: string;
  rule_fingerprint: string;
  state: PolicySaveIntent["state"];
  file_outcome: PolicySaveIntent["fileOutcome"];
  approval_outcome: PolicySaveIntent["approvalOutcome"];
  created_at_ms: number;
  updated_at_ms: number;
  conversation_id: string | null;
  run_id: string | null;
  member_id: string | null;
  approval_command_id: string | null;
  intended_document_manifest_id: string | null;
}

const saveIntentColumns = `schema_version, save_intent_id, command_id,
  scope_json, document_identity, observed_digest, intended_digest,
  rule_fingerprint, state, file_outcome, approval_outcome, created_at_ms,
  updated_at_ms, conversation_id, run_id, member_id, approval_command_id,
  intended_document_manifest_id`;

export function readTimelinePolicySaveIntent(
  database: DatabaseSync,
  saveIntentId: string,
): PolicySaveIntent | undefined {
  const row = database
    .prepare(
      `SELECT ${saveIntentColumns} FROM policy_save_intents WHERE save_intent_id = ?`,
    )
    .get(saveIntentId) as PolicySaveIntentRow | undefined;
  return row ? decodeSaveIntent(row) : undefined;
}

export function listPendingTimelinePolicySaveIntents(
  database: DatabaseSync,
  limit: number,
): PolicySaveIntent[] {
  return (
    database
      .prepare(
        `SELECT ${saveIntentColumns} FROM policy_save_intents
         WHERE state IN ('recorded','writing','saved_pending_finalization')
         ORDER BY updated_at_ms, save_intent_id LIMIT ?`,
      )
      .all(limit) as unknown as PolicySaveIntentRow[]
  ).map(decodeSaveIntent);
}

function decodeSaveIntent(row: PolicySaveIntentRow): PolicySaveIntent {
  const common = {
    schemaVersion: row.schema_version,
    saveIntentId: row.save_intent_id,
    commandId: row.command_id,
    scope: decode(row.scope_json),
    documentIdentity: row.document_identity,
    ...(row.observed_digest
      ? { observedDocumentDigest: row.observed_digest }
      : {}),
    intendedDocumentDigest: row.intended_digest,
    ruleFingerprint: row.rule_fingerprint,
    state: row.state,
    fileOutcome: row.file_outcome,
    approvalOutcome: row.approval_outcome,
    createdAt: new Date(row.created_at_ms).toISOString(),
    updatedAt: new Date(row.updated_at_ms).toISOString(),
  };
  return policySaveIntentSchema.parse(
    row.schema_version === 2
      ? {
          ...common,
          conversationId: row.conversation_id,
          runId: row.run_id,
          memberId: row.member_id,
          approvalCommandId: row.approval_command_id,
          intendedDocumentManifestId: row.intended_document_manifest_id,
        }
      : common,
  );
}

export function persistTimelinePolicySaveIntent(
  database: DatabaseSync,
  intent: PolicySaveIntent,
): void {
  const current = database
    .prepare(
      `SELECT schema_version, command_id, scope_json, document_identity,
              observed_digest, intended_digest, rule_fingerprint, state,
              conversation_id, run_id, member_id, approval_command_id,
              intended_document_manifest_id
       FROM policy_save_intents WHERE save_intent_id = ?`,
    )
    .get(intent.saveIntentId) as
    | {
        schema_version: number;
        command_id: string;
        scope_json: Uint8Array;
        document_identity: string;
        observed_digest: string | null;
        intended_digest: string;
        rule_fingerprint: string;
        state: PolicySaveIntent["state"];
        conversation_id: string | null;
        run_id: string | null;
        member_id: string | null;
        approval_command_id: string | null;
        intended_document_manifest_id: string | null;
      }
    | undefined;
  if (current) {
    if (
      current.schema_version !== intent.schemaVersion ||
      current.command_id !== intent.commandId ||
      !Buffer.from(current.scope_json).equals(
        Buffer.from(encode(intent.scope)),
      ) ||
      current.document_identity !== intent.documentIdentity ||
      current.observed_digest !== (intent.observedDocumentDigest ?? null) ||
      current.intended_digest !== intent.intendedDocumentDigest ||
      current.rule_fingerprint !== intent.ruleFingerprint ||
      current.conversation_id !==
        (intent.schemaVersion === 2 ? intent.conversationId : null) ||
      current.run_id !== (intent.schemaVersion === 2 ? intent.runId : null) ||
      current.member_id !==
        (intent.schemaVersion === 2 ? intent.memberId : null) ||
      current.approval_command_id !==
        (intent.schemaVersion === 2 ? intent.approvalCommandId : null) ||
      current.intended_document_manifest_id !==
        (intent.schemaVersion === 2
          ? intent.intendedDocumentManifestId
          : null) ||
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
         save_intent_id, schema_version, scope_json, command_id,
         document_identity, observed_digest, intended_digest,
         rule_fingerprint, state, file_outcome, approval_outcome,
         created_at_ms, updated_at_ms, conversation_id, run_id, member_id,
         approval_command_id, intended_document_manifest_id
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'recorded', 'not_attempted',
                 'not_attempted', ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      intent.saveIntentId,
      intent.schemaVersion,
      encode(intent.scope),
      intent.commandId,
      intent.documentIdentity,
      intent.observedDocumentDigest ?? null,
      intent.intendedDocumentDigest,
      intent.ruleFingerprint,
      Date.parse(intent.createdAt),
      Date.parse(intent.updatedAt),
      intent.schemaVersion === 2 ? intent.conversationId : null,
      intent.schemaVersion === 2 ? intent.runId : null,
      intent.schemaVersion === 2 ? intent.memberId : null,
      intent.schemaVersion === 2 ? intent.approvalCommandId : null,
      intent.schemaVersion === 2 ? intent.intendedDocumentManifestId : null,
    );
}
