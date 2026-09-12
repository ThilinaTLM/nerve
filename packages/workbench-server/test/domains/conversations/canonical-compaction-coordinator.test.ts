import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { RunControl } from "@nervekit/contracts/runs";
import { CanonicalCompactionCoordinator } from "../../../src/domains/conversations/timeline/canonical-compaction-coordinator.js";
import { buildAppendTransition } from "../../../src/domains/conversations/timeline/transition-builders.js";
import { CanonicalStore } from "../../../src/infrastructure/persistence/canonical-sqlite/canonical-store.js";

const hash = `sha256:${"a".repeat(64)}`;

async function fixture(t: test.TestContext) {
  const home = await mkdtemp(join(tmpdir(), "nerve-compaction-boundary-"));
  const store = new CanonicalStore(join(home, "nerve.sqlite"));
  await store.initialize();
  t.after(async () => {
    await store.close();
    await rm(home, { recursive: true, force: true });
  });
  const emptyHead = {
    schemaVersion: 1 as const,
    conversationId: "conv_one",
    revision: 0,
    activeEntryId: null,
    selectionEpoch: 0,
    foregroundRunId: null,
  };
  const transition = buildAppendTransition({
    head: emptyHead,
    identity: {
      commandId: "command_start",
      inputFingerprint: hash,
      actor: { kind: "user" },
      cause: { kind: "request" },
      committedAt: "2026-09-12T00:00:00.000Z",
      transitionId: "transition_start",
    },
    entries: [
      { entryId: "entry_prompt", kind: "user_message", inlineContent: "hello" },
    ],
    foregroundRunId: "run_one",
  });
  const run: RunControl = {
    schemaVersion: 1,
    conversationId: "conv_one",
    runId: "run_one",
    generation: 1,
    boundSelectionEpoch: 0,
    continuationEntryId: "entry_prompt",
    checkpointId: null,
    waitGroupId: null,
    providerPhaseId: null,
    state: "running",
    foregroundOwned: true,
    revision: 1,
  };
  await store.commitConversationCommand({
    namespaceId: "namespace_test",
    executionIncarnationId: "incarnation_test",
    operationKind: "start",
    ownerKind: "conversation",
    ownerId: "conv_one",
    commandId: "command_start",
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
    transitions: [transition],
    runControls: [run],
    outcome: {},
    publicationIntents: [],
    now: "2026-09-12T00:00:00.000Z",
  });
  return { store, run, head: transition.resultingHead };
}

function manifest() {
  return {
    schemaVersion: 1 as const,
    conversationId: "conv_one",
    sourceTipEntryId: "entry_prompt",
    entryCount: 1,
    entriesManifest: {
      artifactId: "artifact_source_manifest",
      ownerKind: "conversation" as const,
      ownerId: "conv_one",
      relativeLocator: "context/source-manifest.json",
      digest: hash,
      byteLength: 64,
      mediaType: "application/json",
      semanticRole: "context_source_manifest",
      availability: "available" as const,
    },
    transitiveBoundaryCount: 0,
    digest: hash,
  };
}

test("INV-CONTEXT-01 commits a prepared boundary before admitting continuation", async (t) => {
  const { store, run, head } = await fixture(t);
  const coordinator = new CanonicalCompactionCoordinator(store);
  const prepared = {
    namespaceId: "namespace_test",
    executionIncarnationId: "incarnation_test",
    commandId: "command_compact",
    transitionId: "transition_compact",
    boundaryId: "boundary_compact",
    sourceHead: head,
    run,
    anchorEntryId: "entry_prompt",
    sourceManifest: manifest(),
    summary: "Canonical summary",
    summaryEntryId: "entry_summary",
    policyVersion: 1,
    providerAdapterVersion: "test-v1",
    recipeVersion: 1,
    actor: { kind: "system" },
    cause: { kind: "automatic_compaction" },
    preparedAt: "2026-09-12T00:00:01.000Z",
  };
  const committed = await coordinator.commitPrepared(prepared);
  assert.equal(committed.kind, "committed");
  assert.equal(
    committed.kind === "committed" &&
      (await coordinator.revalidateBeforeProviderDispatch(committed.snapshot)),
    true,
  );
  const ancestry = await store.readTimelineAncestrySegment(
    "conv_one",
    "entry_summary",
    2,
  );
  assert.deepEqual(
    ancestry.entries.map((entry) => entry.entryId),
    ["entry_summary", "entry_prompt"],
  );

  const replay = await coordinator.commitPrepared(prepared);
  assert.equal(replay.kind, "receipt_replay");
});

test("INV-CONTEXT-01 rejects incomplete source ancestry manifests", async (t) => {
  const { store, run, head } = await fixture(t);
  const coordinator = new CanonicalCompactionCoordinator(store);
  await assert.rejects(
    coordinator.commitPrepared({
      namespaceId: "namespace_test",
      executionIncarnationId: "incarnation_test",
      commandId: "command_incomplete_compact",
      transitionId: "transition_incomplete_compact",
      boundaryId: "boundary_incomplete_compact",
      sourceHead: head,
      run,
      anchorEntryId: "entry_prompt",
      sourceManifest: { ...manifest(), entryCount: 2 },
      summary: "Incomplete summary",
      summaryEntryId: "entry_incomplete_summary",
      policyVersion: 1,
      providerAdapterVersion: "test-v1",
      recipeVersion: 1,
      actor: { kind: "system" },
      cause: { kind: "automatic_compaction" },
      preparedAt: "2026-09-12T00:00:01.000Z",
    }),
    /completely cover canonical ancestry/,
  );
  assert.equal(
    (await store.readTimelineConversationHead("conv_one"))?.revision,
    1,
  );
});

test("INV-CONTEXT-01 discards a stale prepared summary after ownership changes", async (t) => {
  const { store, run, head } = await fixture(t);
  const coordinator = new CanonicalCompactionCoordinator(store);
  await store.commitConversationCommand({
    namespaceId: "namespace_test",
    executionIncarnationId: "incarnation_test",
    operationKind: "advance",
    ownerKind: "conversation",
    ownerId: "conv_one",
    commandId: "command_advance",
    fingerprintVersion: 1,
    fingerprint: hash,
    expectedHeads: [
      { conversationId: "conv_one", revision: 1, selectionEpoch: 0 },
    ],
    transitions: [
      buildAppendTransition({
        head,
        identity: {
          commandId: "command_advance",
          inputFingerprint: hash,
          actor: { kind: "user" },
          cause: { kind: "steer" },
          committedAt: "2026-09-12T00:00:01.000Z",
          transitionId: "transition_advance",
        },
        entries: [
          {
            entryId: "entry_advance",
            kind: "user_message",
            inlineContent: "new",
          },
        ],
        foregroundRunId: "run_one",
      }),
    ],
    runControls: [
      { ...run, continuationEntryId: "entry_advance", revision: 2 },
    ],
    outcome: {},
    publicationIntents: [],
    now: "2026-09-12T00:00:01.000Z",
  });
  let providerPreparationCalled = false;
  const stale = await coordinator.commitThenPrepareProviderPhase(
    {
      namespaceId: "namespace_test",
      executionIncarnationId: "incarnation_test",
      commandId: "command_stale_compact",
      sourceHead: head,
      run,
      anchorEntryId: "entry_prompt",
      sourceManifest: manifest(),
      summary: "Stale summary",
      summaryEntryId: "entry_stale_summary",
      policyVersion: 1,
      providerAdapterVersion: "test-v1",
      recipeVersion: 1,
      actor: { kind: "system" },
      cause: { kind: "automatic_compaction" },
      preparedAt: "2026-09-12T00:00:02.000Z",
    },
    async () => {
      providerPreparationCalled = true;
      return {};
    },
  );
  assert.equal(stale.kind, "stale");
  assert.equal(providerPreparationCalled, false);
  await assert.rejects(
    store.readTimelineAncestrySegment("conv_one", "entry_stale_summary", 1),
    /not found/,
  );
});
