import assert from "node:assert/strict";
import test from "node:test";
import { buildCanonicalToolBatch } from "../../../src/domains/conversations/timeline/canonical-tool-batch.js";

const fingerprint = `sha256:${"a".repeat(64)}` as const;
const documentDigest = `sha256:${"b".repeat(64)}` as const;
const selectedDigest = `sha256:${"c".repeat(64)}` as const;

function proposal(admission: "authorized" | "awaiting_approval" | "denied") {
  return {
    admission,
    providerToolCallId: `call-${admission}`,
    toolName: "read",
    normalizedInputFingerprint: fingerprint,
    normalizedInput: { path: "README.md" },
    cwd: "/tmp/project",
    risk: "read" as const,
    capability: { kind: "safe_repeat_observation" as const, version: 1 },
    policyObservation: {
      schemaVersion: 1 as const,
      observationId: `policy_observation_${admission}`,
      scope: { kind: "conversation" as const, ownerId: "conv_batch" },
      documentIdentity: "permissions.json",
      completeDocumentDigest: documentDigest,
      selectedRuleSetId: "baseline",
      selectedRuleSetDigest: selectedDigest,
      applicableOverlayDigests: [],
      normalizedInputFingerprint: fingerprint,
      trustEvidence: {},
      observedAt: "2026-09-14T00:00:00.000Z",
    },
    authorizationEvidence: { decision: admission },
    owner: { conversationId: "conv_batch", agentId: "agent_batch" },
  };
}

function batch(admission: "authorized" | "awaiting_approval" | "denied") {
  return buildCanonicalToolBatch({
    conversationId: "conv_batch",
    runId: "run_batch",
    runGeneration: 1,
    selectionEpoch: 0,
    continuationEntryId: "entry_batch",
    phaseId: "provider_phase_batch",
    providerIdentity: { provider: "test" },
    providerCapability: "stateless_generation",
    proposals: [proposal(admission)],
    now: "2026-09-14T00:00:00.000Z",
  })!;
}

test("canonical tool batch admits only allowed calls to effect dispatch", () => {
  const authorized = batch("authorized");
  assert.equal(authorized.effects.length, 1);
  assert.equal(authorized.authorizations.length, 1);
  assert.equal(authorized.work[0]?.kind, "claim_tool_attempt");
  assert.equal(authorized.waitGroup.members[0]?.executionState, "authorized");

  const awaiting = batch("awaiting_approval");
  assert.equal(awaiting.effects.length, 0);
  assert.equal(awaiting.work.length, 0);
  assert.equal(
    awaiting.waitGroup.members[0]?.executionState,
    "awaiting_approval",
  );
});

test("a denied-only batch proves non-dispatch and schedules continuation", () => {
  const denied = batch("denied");
  assert.equal(denied.effects.length, 0);
  assert.equal(denied.waitGroup.state, "ready");
  assert.equal(
    denied.waitGroup.members[0]?.attachmentDisposition,
    "not_executed",
  );
  assert.equal(denied.work[0]?.kind, "prepare_continuation");
});
