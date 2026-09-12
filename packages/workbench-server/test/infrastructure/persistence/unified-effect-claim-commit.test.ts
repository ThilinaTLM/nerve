import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  buildAppendTransition,
  buildControlTransition,
} from "../../../src/domains/conversations/timeline/transition-builders.js";
import { CanonicalStore } from "../../../src/infrastructure/persistence/canonical-sqlite/canonical-store.js";

const hash = `sha256:${"a".repeat(64)}`;
const now = "2026-09-12T00:00:00.000Z";

test("INV-EFFECT-01 atomically authorizes an effect and claims its attempt", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "nerve-unified-effect-"));
  const store = new CanonicalStore(join(home, "nerve.sqlite"));
  await store.initialize();
  t.after(async () => {
    await store.close();
    await rm(home, { recursive: true, force: true });
  });
  const started = buildAppendTransition({
    head: {
      schemaVersion: 1,
      conversationId: "conv_effect",
      revision: 0,
      activeEntryId: null,
      selectionEpoch: 0,
      foregroundRunId: null,
    },
    identity: {
      commandId: "command_effect",
      inputFingerprint: hash,
      actor: { kind: "agent" },
      cause: { kind: "tool_proposal" },
      committedAt: now,
      transitionId: "transition_effect",
    },
    entries: [
      {
        entryId: "entry_effect",
        kind: "tool_proposal",
        inlineContent: { tool: "read" },
        runId: "run_effect",
        toolCallId: "tool_effect",
      },
    ],
    foregroundRunId: "run_effect",
  });
  const run = {
    schemaVersion: 1 as const,
    conversationId: "conv_effect",
    runId: "run_effect",
    generation: 1,
    boundSelectionEpoch: 0,
    continuationEntryId: "entry_effect",
    checkpointId: null,
    waitGroupId: "wait_group_effect",
    providerPhaseId: null,
    state: "waiting" as const,
    foregroundOwned: true,
    revision: 1,
  };
  const first = await store.commitConversationCommand({
    namespaceId: "namespace_test",
    executionIncarnationId: "incarnation_test",
    operationKind: "authorize_effect",
    ownerKind: "conversation",
    ownerId: "conv_effect",
    commandId: "command_effect",
    fingerprintVersion: 1,
    fingerprint: hash,
    expectedHeads: [
      {
        conversationId: "conv_effect",
        revision: 0,
        selectionEpoch: 0,
        createIfMissing: true,
      },
    ],
    transitions: [started],
    runControls: [run],
    waitGroups: [
      {
        schemaVersion: 1,
        waitGroupId: "wait_group_effect",
        runId: "run_effect",
        membershipManifestId: "manifest_members_effect",
        continuationEntryId: "entry_effect",
        continuationConsumed: false,
        state: "open",
        revision: 1,
        members: [
          {
            schemaVersion: 1,
            memberId: "member_effect",
            waitGroupId: "wait_group_effect",
            memberKind: "tool",
            ownerId: "tool_effect",
            inputFingerprint: hash,
            executionState: "authorized",
            attachmentDisposition: "pending",
            contributesToBarrier: false,
            revision: 1,
          },
        ],
      },
    ],
    policyObservations: [
      {
        schemaVersion: 1,
        observationId: "policy_observation_effect",
        scope: { kind: "conversation", ownerId: "conv_effect" },
        documentIdentity: "permissions/project.json",
        completeDocumentDigest: hash,
        selectedRuleSetId: "baseline",
        selectedRuleSetDigest: hash,
        applicableOverlayDigests: [],
        normalizedInputFingerprint: hash,
        trustEvidence: { trusted: true },
        observedAt: now,
      },
    ],
    authorizations: [
      {
        schemaVersion: 1,
        authorizationId: "authorization_effect",
        memberId: "member_effect",
        normalizedInputFingerprint: hash,
        policyObservationId: "policy_observation_effect",
        runGeneration: 1,
        selectionEpoch: 0,
        state: "active",
        evidence: { policy: "observed" },
        createdAt: now,
      },
    ],
    logicalEffects: [
      {
        schemaVersion: 1,
        effectId: "effect_one",
        memberId: "member_effect",
        toolName: "read",
        capability: { kind: "safe_repeat_observation", version: 1 },
        normalizedInputFingerprint: hash,
        owner: { conversationId: "conv_effect", runId: "run_effect" },
        authorizationId: "authorization_effect",
        state: "authorized",
        createdAt: now,
      },
    ],
    executionAttempts: [
      {
        schemaVersion: 1,
        attemptId: "attempt_effect",
        effectId: "effect_one",
        attemptNumber: 1,
        executionIncarnationId: "incarnation_test",
        state: "ready",
        createdAt: now,
        updatedAt: now,
      },
    ],
    outcome: { effectId: "effect_one" },
    publicationIntents: [],
    now,
  });
  assert.equal(first.kind, "committed");

  const head = started.resultingHead;
  const claimTransition = buildControlTransition({
    head,
    kind: "execution_changed",
    identity: {
      commandId: "command_claim",
      inputFingerprint: hash,
      actor: { kind: "scheduler" },
      cause: { kind: "claim" },
      committedAt: "2026-09-12T00:00:01.000Z",
      transitionId: "transition_claim",
    },
  });
  const claimed = await store.commitConversationCommand({
    namespaceId: "namespace_test",
    executionIncarnationId: "incarnation_test",
    operationKind: "claim_effect",
    ownerKind: "conversation",
    ownerId: "conv_effect",
    commandId: "command_claim",
    fingerprintVersion: 1,
    fingerprint: hash,
    expectedHeads: [
      { conversationId: "conv_effect", revision: 1, selectionEpoch: 0 },
    ],
    transitions: [claimTransition],
    runControls: [{ ...run, revision: 2 }],
    executionAttempts: [
      {
        schemaVersion: 1,
        attemptId: "attempt_effect",
        effectId: "effect_one",
        attemptNumber: 1,
        executionIncarnationId: "incarnation_test",
        state: "claimed",
        createdAt: now,
        updatedAt: "2026-09-12T00:00:01.000Z",
      },
    ],
    executionClaims: [
      {
        schemaVersion: 1,
        claimId: "claim_effect",
        attemptId: "attempt_effect",
        token: "claim-token-with-at-least-thirty-two-characters",
        generation: 1,
        executionIncarnationId: "incarnation_test",
        leaseDeadline: "2026-09-12T00:05:00.000Z",
        state: "active",
      },
    ],
    outcome: { claimId: "claim_effect" },
    publicationIntents: [],
    now: "2026-09-12T00:00:01.000Z",
  });
  assert.equal(claimed.kind, "committed");

  const settledTransition = buildControlTransition({
    head: claimTransition.resultingHead,
    kind: "execution_changed",
    identity: {
      commandId: "command_settle",
      inputFingerprint: hash,
      actor: { kind: "worker" },
      cause: { kind: "result" },
      committedAt: "2026-09-12T00:00:02.000Z",
      transitionId: "transition_settle",
    },
  });
  const settled = await store.commitConversationCommand({
    namespaceId: "namespace_test",
    executionIncarnationId: "incarnation_test",
    operationKind: "settle_effect",
    ownerKind: "conversation",
    ownerId: "conv_effect",
    commandId: "command_settle",
    fingerprintVersion: 1,
    fingerprint: hash,
    expectedHeads: [
      { conversationId: "conv_effect", revision: 2, selectionEpoch: 0 },
    ],
    transitions: [settledTransition],
    runControls: [{ ...run, revision: 3 }],
    executionAttempts: [
      {
        schemaVersion: 1,
        attemptId: "attempt_effect",
        effectId: "effect_one",
        attemptNumber: 1,
        executionIncarnationId: "incarnation_test",
        state: "dispatched",
        createdAt: now,
        updatedAt: "2026-09-12T00:00:02.000Z",
      },
      {
        schemaVersion: 1,
        attemptId: "attempt_effect",
        effectId: "effect_one",
        attemptNumber: 1,
        executionIncarnationId: "incarnation_test",
        state: "succeeded",
        outcome: { kind: "observation", digest: hash },
        createdAt: now,
        updatedAt: "2026-09-12T00:00:02.000Z",
      },
    ],
    executionClaims: [
      {
        schemaVersion: 1,
        claimId: "claim_effect",
        attemptId: "attempt_effect",
        token: "claim-token-with-at-least-thirty-two-characters",
        generation: 1,
        executionIncarnationId: "incarnation_test",
        leaseDeadline: "2026-09-12T00:05:00.000Z",
        state: "consumed",
      },
    ],
    outcome: { attemptId: "attempt_effect" },
    publicationIntents: [],
    now: "2026-09-12T00:00:02.000Z",
  });
  assert.equal(settled.kind, "committed");

  const staleTransition = buildControlTransition({
    head: settledTransition.resultingHead,
    kind: "execution_changed",
    identity: {
      commandId: "command_stale_claim",
      inputFingerprint: hash,
      actor: { kind: "scheduler" },
      cause: { kind: "stale_incarnation" },
      committedAt: "2026-09-12T00:00:03.000Z",
      transitionId: "transition_stale_claim",
    },
  });
  await assert.rejects(
    store.commitConversationCommand({
      namespaceId: "namespace_test",
      executionIncarnationId: "incarnation_test",
      operationKind: "dispatch_effect",
      ownerKind: "conversation",
      ownerId: "conv_effect",
      commandId: "command_stale_claim",
      fingerprintVersion: 1,
      fingerprint: hash,
      expectedHeads: [
        { conversationId: "conv_effect", revision: 3, selectionEpoch: 0 },
      ],
      transitions: [staleTransition],
      runControls: [{ ...run, revision: 4 }],
      executionAttempts: [
        {
          schemaVersion: 1,
          attemptId: "attempt_effect",
          effectId: "effect_one",
          attemptNumber: 1,
          executionIncarnationId: "incarnation_stale",
          state: "dispatched",
          createdAt: now,
          updatedAt: "2026-09-12T00:00:03.000Z",
        },
      ],
      outcome: {},
      publicationIntents: [],
      now: "2026-09-12T00:00:03.000Z",
    }),
    /incarnation is stale/,
  );
  assert.equal(
    (await store.readTimelineConversationHead("conv_effect"))?.revision,
    3,
  );
});
