import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { PolicySaveIntent } from "@nervekit/contracts/permissions";
import { CanonicalStore } from "../../../src/infrastructure/persistence/canonical-sqlite/canonical-store.js";

const hash = `sha256:${"b".repeat(64)}`;
const now = "2026-09-12T00:00:00.000Z";

function command(commandId: string) {
  return {
    namespaceId: "namespace_test",
    executionIncarnationId: "incarnation_test",
    operationKind: "policy_evidence",
    ownerKind: "policy_scope" as const,
    ownerId: "conversation:conv_policy",
    commandId,
    fingerprintVersion: 1,
    fingerprint: hash,
    expectedHeads: [],
    transitions: [],
    publicationIntents: [],
    outcome: { commandId },
    now,
  };
}

const recordedSave: PolicySaveIntent = {
  schemaVersion: 1,
  saveIntentId: "policy_save_one",
  commandId: "policy-save",
  scope: { kind: "conversation", ownerId: "conv_policy" },
  documentIdentity: "permissions/project.json",
  observedDocumentDigest: hash,
  intendedDocumentDigest: hash,
  ruleFingerprint: hash,
  state: "recorded",
  fileOutcome: "not_attempted",
  approvalOutcome: "not_attempted",
  createdAt: now,
  updatedAt: now,
};

test("INV-POLICY-01 persists file-authoritative observations and partial save outcomes", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "nerve-unified-policy-"));
  const store = new CanonicalStore(join(home, "nerve.sqlite"));
  await store.initialize();
  t.after(async () => {
    await store.close();
    await rm(home, { recursive: true, force: true });
  });

  const observed = await store.commitConversationCommand({
    ...command("policy-observed"),
    policyObservations: [
      {
        schemaVersion: 1,
        observationId: "policy_observation_one",
        scope: { kind: "conversation", ownerId: "conv_policy" },
        documentIdentity: "permissions/project.json",
        completeDocumentDigest: hash,
        selectedRuleSetId: "custom",
        selectedRuleSetDigest: hash,
        applicableOverlayDigests: [],
        normalizedInputFingerprint: hash,
        trustEvidence: { projectDigest: hash },
        observedAt: now,
      },
    ],
    policyDiagnostics: [
      {
        schemaVersion: 1,
        diagnosticId: "policy_diagnostic_one",
        scope: { kind: "conversation", ownerId: "conv_policy" },
        documentIdentity: "permissions/project.json",
        failureFingerprint: hash,
        failureKind: "malformed_overlay",
        affectedMemberIds: [],
        state: "unresolved",
        observedAt: now,
      },
    ],
    policySaveIntents: [recordedSave],
  });
  assert.equal(observed.kind, "committed");

  const fallback = await store.commitConversationCommand({
    ...command("policy-fallback"),
    policyDiagnostics: [
      {
        schemaVersion: 1,
        diagnosticId: "policy_diagnostic_one",
        scope: { kind: "conversation", ownerId: "conv_policy" },
        documentIdentity: "permissions/project.json",
        failureFingerprint: hash,
        failureKind: "malformed_overlay",
        affectedMemberIds: [],
        state: "fallback_selected",
        observedAt: now,
        resolvedAt: "2026-09-12T00:00:01.000Z",
      },
    ],
    policyFallbackDecisions: [
      {
        schemaVersion: 1,
        decisionId: "policy_decision_one",
        diagnosticId: "policy_diagnostic_one",
        requestedRuleSetId: "custom",
        effectiveRuleSetId: "baseline",
        overlaysEnabled: false,
        confirmationFingerprint: hash,
        state: "active",
        decidedAt: "2026-09-12T00:00:01.000Z",
      },
    ],
  });
  assert.equal(fallback.kind, "committed");

  for (const [index, save] of [
    {
      ...recordedSave,
      state: "writing",
      updatedAt: "2026-09-12T00:00:02.000Z",
    },
    {
      ...recordedSave,
      state: "saved_pending_finalization",
      fileOutcome: "saved",
      updatedAt: "2026-09-12T00:00:03.000Z",
    },
    {
      ...recordedSave,
      state: "finalized",
      fileOutcome: "saved",
      approvalOutcome: "committed",
      updatedAt: "2026-09-12T00:00:04.000Z",
    },
  ].entries()) {
    const result = await store.commitConversationCommand({
      ...command(`policy-save-${index}`),
      policySaveIntents: [save as PolicySaveIntent],
    });
    assert.equal(result.kind, "committed");
  }
});

test("INV-POLICY-04 binds remembered saves to prepared bytes and approval identity", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "nerve-unified-policy-v2-"));
  const store = new CanonicalStore(join(home, "nerve.sqlite"));
  await store.initialize();
  t.after(async () => {
    await store.close();
    await rm(home, { recursive: true, force: true });
  });
  const intent: PolicySaveIntent = {
    schemaVersion: 2,
    saveIntentId: "policy_save_v2",
    commandId: "remember-project-rule",
    scope: { kind: "project", ownerId: "proj_policy" },
    documentIdentity: "projects/proj_policy/permissions.json",
    observedDocumentDigest: hash,
    intendedDocumentDigest: hash,
    ruleFingerprint: hash,
    conversationId: "conv_policy",
    runId: "run_policy",
    memberId: "member_policy",
    approvalCommandId: "approval-policy-v2",
    intendedDocumentManifestId: "manifest_policy_save_v2",
    state: "recorded",
    fileOutcome: "not_attempted",
    approvalOutcome: "not_attempted",
    createdAt: now,
    updatedAt: now,
  };
  const recorded = await store.commitConversationCommand({
    ...command("policy-save-v2-recorded"),
    artifactManifests: [
      {
        manifestId: "manifest_policy_save_v2",
        schemaVersion: 1,
        data: {
          schemaVersion: 1,
          mediaType: "application/json",
          bytesBase64: Buffer.from("{}\n").toString("base64"),
          intendedDocumentDigest: hash,
        },
      },
    ],
    policySaveIntents: [intent],
  });
  assert.equal(recorded.kind, "committed");
  assert.deepEqual(
    await store.policy.readSaveIntent(intent.saveIntentId),
    intent,
  );
  assert.deepEqual(
    (await store.policy.listPendingSaveIntents()).map(
      (candidate) => candidate.saveIntentId,
    ),
    [intent.saveIntentId],
  );
  const writing = await store.commitConversationCommand({
    ...command("policy-save-v2-writing"),
    policySaveIntents: [
      {
        ...intent,
        state: "writing",
        updatedAt: "2026-09-12T00:00:01.000Z",
      },
    ],
  });
  assert.equal(writing.kind, "committed");
});
