import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { ConversationTransition } from "@nervekit/contracts/conversations";
import { CanonicalStore } from "../../../src/infrastructure/persistence/canonical-sqlite/canonical-store.js";

const hash = `sha256:${"a".repeat(64)}`;

function transition(
  conversationId: string,
  revision: number,
  commandId: string,
  parentEntryId: string | null = null,
): ConversationTransition {
  const transitionId = `transition_${conversationId}_${revision}`;
  const entryId = `entry_${conversationId}_${revision}`;
  return {
    schemaVersion: 1,
    transitionId,
    conversationId,
    revision,
    kind: "entries_appended",
    commandId,
    inputFingerprint: hash,
    actor: { kind: "test" },
    cause: { kind: "test" },
    committedAt: "2026-09-12T00:00:00.000Z",
    entries: [
      {
        schemaVersion: 1,
        entryId,
        conversationId,
        transitionId,
        ordinal: 0,
        parentEntryId,
        kind: "user_message",
        inlineContent: { text: "hello" },
        artifacts: [],
        provenance: {},
      },
    ],
    evidenceReferences: [],
    resultingHead: {
      schemaVersion: 1,
      conversationId,
      revision,
      activeEntryId: entryId,
      selectionEpoch: 0,
      foregroundRunId: null,
    },
  };
}

async function fixture(t: test.TestContext) {
  const home = await mkdtemp(join(tmpdir(), "nerve-unified-timeline-"));
  const store = new CanonicalStore(join(home, "nerve.sqlite"));
  await store.initialize();
  t.after(async () => {
    await store.close();
    await rm(home, { recursive: true, force: true });
  });
  return store;
}

test("INV-COMMIT-01 commits multiple conversation transitions and publication intents atomically", async (t) => {
  const store = await fixture(t);
  const first = transition("conv_first", 1, "command_cross");
  const second = transition("conv_second", 1, "command_cross");
  const result = await store.commitConversationCommand({
    namespaceId: "namespace_test",
    executionIncarnationId: "incarnation_test",
    operationKind: "accept_plan",
    ownerKind: "conversation",
    ownerId: "conv_source",
    commandId: "command_cross",
    fingerprintVersion: 1,
    fingerprint: hash,
    expectedHeads: [
      {
        conversationId: "conv_first",
        revision: 0,
        selectionEpoch: 0,
        createIfMissing: true,
      },
      {
        conversationId: "conv_second",
        revision: 0,
        selectionEpoch: 0,
        createIfMissing: true,
      },
    ],
    transitions: [second, first],
    outcome: { accepted: true },
    publicationIntents: [
      {
        intentId: "intent_cross",
        stream: "workspace:test",
        eventType: "conversation.changed",
        occurredAt: "2026-09-12T00:00:00.000Z",
        data: { conversations: ["conv_first", "conv_second"] },
      },
    ],
    now: "2026-09-12T00:00:00.000Z",
  });
  assert.equal(result.kind, "committed");
  assert.deepEqual(
    result.kind === "committed"
      ? result.positions.map((position) => position.conversationId)
      : [],
    ["conv_first", "conv_second"],
  );
  assert.equal(
    (await store.readTimelineConversationHead("conv_first"))?.revision,
    1,
  );
  assert.equal(
    (await store.readTimelineConversationHead("conv_second"))?.revision,
    1,
  );
  assert.equal(
    (await store.durableEventForIntent("intent_cross"))?.intentId,
    "intent_cross",
  );
});

test("INV-COMMIT-01 starts a foreground run and provider obligation atomically", async (t) => {
  const store = await fixture(t);
  const started = transition("conv_run", 1, "command_start");
  started.resultingHead.foregroundRunId = "run_one";
  const result = await store.commitConversationCommand({
    namespaceId: "namespace_test",
    executionIncarnationId: "incarnation_test",
    operationKind: "start_run",
    ownerKind: "conversation",
    ownerId: "conv_run",
    commandId: "command_start",
    fingerprintVersion: 1,
    fingerprint: hash,
    expectedHeads: [
      {
        conversationId: "conv_run",
        revision: 0,
        selectionEpoch: 0,
        createIfMissing: true,
      },
    ],
    transitions: [started],
    runControls: [
      {
        schemaVersion: 1,
        conversationId: "conv_run",
        runId: "run_one",
        generation: 1,
        boundSelectionEpoch: 0,
        continuationEntryId: "entry_conv_run_1",
        checkpointId: null,
        waitGroupId: null,
        providerPhaseId: "provider_phase_one",
        state: "preparing",
        foregroundOwned: true,
        revision: 1,
      },
    ],
    providerPhases: [
      {
        schemaVersion: 1,
        phaseId: "provider_phase_one",
        runId: "run_one",
        runGeneration: 1,
        selectionEpoch: 0,
        sourceEntryId: "entry_conv_run_1",
        contextRecipeId: "context_recipe_one",
        providerIdentity: { provider: "test", model: "one" },
        capability: "stateless_generation",
        state: "preparing",
      },
    ],
    outcome: { runId: "run_one" },
    publicationIntents: [],
    now: "2026-09-12T00:00:00.000Z",
  });
  assert.equal(result.kind, "committed");
  assert.equal(
    (await store.readTimelineConversationHead("conv_run"))?.foregroundRunId,
    "run_one",
  );

  const waiting: ConversationTransition = {
    ...started,
    transitionId: "transition_conv_run_2",
    revision: 2,
    kind: "run_changed",
    commandId: "command_wait",
    entries: [],
    resultingHead: { ...started.resultingHead, revision: 2 },
  };
  const pendingMember = {
    schemaVersion: 1 as const,
    memberId: "member_one",
    waitGroupId: "wait_group_one",
    memberKind: "tool" as const,
    ownerId: "tool_one",
    inputFingerprint: hash,
    executionState: "awaiting_approval" as const,
    attachmentDisposition: "pending" as const,
    contributesToBarrier: false,
    revision: 1,
  };
  assert.equal(
    (
      await store.commitConversationCommand({
        namespaceId: "namespace_test",
        executionIncarnationId: "incarnation_test",
        operationKind: "wait",
        ownerKind: "conversation",
        ownerId: "conv_run",
        commandId: "command_wait",
        fingerprintVersion: 1,
        fingerprint: hash,
        expectedHeads: [
          { conversationId: "conv_run", revision: 1, selectionEpoch: 0 },
        ],
        transitions: [waiting],
        runControls: [
          {
            schemaVersion: 1,
            conversationId: "conv_run",
            runId: "run_one",
            generation: 1,
            boundSelectionEpoch: 0,
            continuationEntryId: "entry_conv_run_1",
            checkpointId: null,
            waitGroupId: "wait_group_one",
            providerPhaseId: "provider_phase_one",
            state: "waiting",
            foregroundOwned: true,
            revision: 2,
          },
        ],
        waitGroups: [
          {
            schemaVersion: 1,
            waitGroupId: "wait_group_one",
            runId: "run_one",
            membershipManifestId: "manifest_wait_group_one",
            continuationEntryId: "entry_conv_run_1",
            continuationConsumed: false,
            state: "open",
            revision: 1,
            members: [pendingMember],
          },
        ],
        outcome: {},
        publicationIntents: [],
        now: "2026-09-12T00:00:01.000Z",
      })
    ).kind,
    "committed",
  );

  const resolved: ConversationTransition = {
    ...waiting,
    transitionId: "transition_conv_run_3",
    revision: 3,
    commandId: "command_resolve",
    resultingHead: { ...waiting.resultingHead, revision: 3 },
  };
  assert.equal(
    (
      await store.commitConversationCommand({
        namespaceId: "namespace_test",
        executionIncarnationId: "incarnation_test",
        operationKind: "resolve",
        ownerKind: "conversation",
        ownerId: "conv_run",
        commandId: "command_resolve",
        fingerprintVersion: 1,
        fingerprint: hash,
        expectedHeads: [
          { conversationId: "conv_run", revision: 2, selectionEpoch: 0 },
        ],
        transitions: [resolved],
        runControls: [
          {
            schemaVersion: 1,
            conversationId: "conv_run",
            runId: "run_one",
            generation: 1,
            boundSelectionEpoch: 0,
            continuationEntryId: "entry_conv_run_1",
            checkpointId: null,
            waitGroupId: "wait_group_one",
            providerPhaseId: "provider_phase_one",
            state: "waiting",
            foregroundOwned: true,
            revision: 3,
          },
        ],
        waitGroups: [
          {
            schemaVersion: 1,
            waitGroupId: "wait_group_one",
            runId: "run_one",
            membershipManifestId: "manifest_wait_group_one",
            continuationEntryId: "entry_conv_run_1",
            continuationConsumed: false,
            state: "ready",
            revision: 2,
            members: [
              {
                ...pendingMember,
                executionState: "denied",
                attachmentDisposition: "not_executed",
                nonDispatchEvidenceId: "evidence_denied",
                contributesToBarrier: true,
                revision: 2,
              },
            ],
          },
        ],
        outcome: {},
        publicationIntents: [],
        now: "2026-09-12T00:00:02.000Z",
      })
    ).kind,
    "committed",
  );
});

test("INV-RECEIPT-01 replays before stale CAS and rejects changed fingerprints", async (t) => {
  const store = await fixture(t);
  const base = {
    namespaceId: "namespace_test",
    executionIncarnationId: "incarnation_test",
    operationKind: "append",
    ownerKind: "conversation" as const,
    ownerId: "conv_one",
    commandId: "command_one",
    fingerprintVersion: 1,
    fingerprint: hash,
    expectedHeads: [
      {
        conversationId: "conv_one",
        revision: 0,
        selectionEpoch: 0,
        createIfMissing: true,
      },
    ],
    transitions: [transition("conv_one", 1, "command_one")],
    outcome: { entryId: "entry_conv_one_1" },
    publicationIntents: [],
    now: "2026-09-12T00:00:00.000Z",
  };
  assert.equal((await store.commitConversationCommand(base)).kind, "committed");
  assert.equal(
    (await store.commitConversationCommand(base)).kind,
    "receipt_replay",
  );
  assert.equal(
    await store.timelineEntryIsAncestor("conv_one", null, "entry_conv_one_1"),
    true,
  );
  assert.equal(
    (
      await store.commitConversationCommand({
        ...base,
        fingerprint: `sha256:${"b".repeat(64)}`,
      })
    ).kind,
    "fingerprint_mismatch",
  );
  const next = transition("conv_one", 2, "command_two", "entry_conv_one_1");
  await store.commitConversationCommand({
    ...base,
    commandId: "command_two",
    fingerprint: `sha256:${"c".repeat(64)}`,
    expectedHeads: [
      { conversationId: "conv_one", revision: 1, selectionEpoch: 0 },
    ],
    transitions: [next],
  });
  assert.equal(
    await store.timelineEntryIsAncestor(
      "conv_one",
      "entry_conv_one_1",
      "entry_conv_one_2",
    ),
    true,
  );
  assert.equal(
    await store.timelineEntryIsAncestor(
      "conv_one",
      "entry_conv_one_2",
      "entry_conv_one_1",
    ),
    false,
  );
});

test("INV-COMMIT-01 does not create one owner when another CAS precondition fails", async (t) => {
  const store = await fixture(t);
  await store.commitConversationCommand({
    namespaceId: "namespace_test",
    executionIncarnationId: "incarnation_test",
    operationKind: "seed",
    ownerKind: "conversation",
    ownerId: "conv_existing",
    commandId: "command_seed",
    fingerprintVersion: 1,
    fingerprint: hash,
    expectedHeads: [
      {
        conversationId: "conv_existing",
        revision: 0,
        selectionEpoch: 0,
        createIfMissing: true,
      },
    ],
    transitions: [transition("conv_existing", 1, "command_seed")],
    outcome: {},
    publicationIntents: [],
    now: "2026-09-12T00:00:00.000Z",
  });
  const result = await store.commitConversationCommand({
    namespaceId: "namespace_test",
    executionIncarnationId: "incarnation_test",
    operationKind: "cross_conflict",
    ownerKind: "state",
    ownerId: "namespace_test",
    commandId: "command_conflict",
    fingerprintVersion: 1,
    fingerprint: `sha256:${"d".repeat(64)}`,
    expectedHeads: [
      {
        conversationId: "conv_new",
        revision: 0,
        selectionEpoch: 0,
        createIfMissing: true,
      },
      {
        conversationId: "conv_existing",
        revision: 0,
        selectionEpoch: 0,
      },
    ],
    transitions: [],
    outcome: {},
    publicationIntents: [],
    now: "2026-09-12T00:00:01.000Z",
  });
  assert.equal(result.kind, "cas_conflict");
  assert.equal(await store.readTimelineConversationHead("conv_new"), undefined);
});

test("INV-ID-01 rolls back a command with an invalid cross-owner parent", async (t) => {
  const store = await fixture(t);
  const first = transition("conv_first", 1, "command_invalid");
  const second = transition(
    "conv_second",
    1,
    "command_invalid",
    "entry_conv_first_1",
  );
  await assert.rejects(
    store.commitConversationCommand({
      namespaceId: "namespace_test",
      executionIncarnationId: "incarnation_test",
      operationKind: "invalid",
      ownerKind: "state",
      ownerId: "namespace_test",
      commandId: "command_invalid",
      fingerprintVersion: 1,
      fingerprint: hash,
      expectedHeads: [
        {
          conversationId: "conv_first",
          revision: 0,
          selectionEpoch: 0,
          createIfMissing: true,
        },
        {
          conversationId: "conv_second",
          revision: 0,
          selectionEpoch: 0,
          createIfMissing: true,
        },
      ],
      transitions: [first, second],
      outcome: {},
      publicationIntents: [],
      now: "2026-09-12T00:00:00.000Z",
    }),
    /invalid parent|form a chain/,
  );
  assert.equal(
    await store.readTimelineConversationHead("conv_first"),
    undefined,
  );
  assert.equal(
    await store.readTimelineConversationHead("conv_second"),
    undefined,
  );
});
