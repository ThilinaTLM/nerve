import assert from "node:assert/strict";
import test from "node:test";
import { buildCanonicalToolBatch } from "../../../src/domains/conversations/timeline/canonical-tool-batch.js";

const fingerprint = `sha256:${"a".repeat(64)}` as const;
const documentDigest = `sha256:${"b".repeat(64)}` as const;
const selectedDigest = `sha256:${"c".repeat(64)}` as const;

type Admission =
  | "authorized"
  | "awaiting_approval"
  | "policy_blocked"
  | "denied"
  | "internal_command";

function proposal(admission: Admission) {
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
    ...(admission === "policy_blocked"
      ? {
          policyFailure: {
            scope: { kind: "conversation" as const, ownerId: "conv_batch" },
            documentIdentity: "conversation:permissions.json",
            failureFingerprint: fingerprint,
            failureKind: "malformed_overlay" as const,
          },
        }
      : {}),
    owner: { conversationId: "conv_batch", agentId: "agent_batch" },
  };
}

function batch(admission: Admission) {
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

  const internal = batch("internal_command");
  assert.equal(internal.effects.length, 1);
  assert.equal(internal.authorizations.length, 1);
  assert.equal(internal.work[0]?.kind, "claim_tool_attempt");
  assert.equal(internal.waitGroup.members[0]?.executionState, "authorized");

  const awaiting = batch("awaiting_approval");
  assert.equal(awaiting.effects.length, 0);
  assert.equal(awaiting.work.length, 0);
  assert.equal(
    awaiting.waitGroup.members[0]?.executionState,
    "awaiting_approval",
  );
  assert.equal(awaiting.toolCalls[0]?.status, "waiting");
  assert.equal(awaiting.toolCalls[0]?.interactions[0]?.kind, "approval");

  const blocked = batch("policy_blocked");
  assert.equal(blocked.effects.length, 0);
  assert.equal(blocked.work.length, 0);
  assert.equal(blocked.policyDiagnostics.length, 1);
  assert.deepEqual(blocked.policyDiagnostics[0]?.affectedMemberIds, [
    blocked.waitGroup.members[0]?.memberId,
  ]);
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
  assert.equal(denied.toolCalls[0]?.status, "denied");
  assert.equal(denied.entries[0]?.kind, "tool_result");
  assert.deepEqual(denied.entries[0]?.inlineContent, {
    exactHarnessMessage: {
      role: "toolResult",
      toolCallId: "call-denied",
      toolName: "read",
      content: [{ type: "text", text: "Tool call denied." }],
      isError: true,
      timestamp: Date.parse("2026-09-14T00:00:00.000Z"),
    },
    failed: true,
  });
  assert.equal(
    denied.waitGroup.continuationEntryId,
    denied.entries[0]?.entryId,
  );
});
