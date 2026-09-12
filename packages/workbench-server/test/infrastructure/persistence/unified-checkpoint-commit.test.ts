import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { buildAppendTransition } from "../../../src/domains/conversations/timeline/transition-builders.js";
import { CanonicalStore } from "../../../src/infrastructure/persistence/canonical-sqlite/canonical-store.js";

const hash = `sha256:${"a".repeat(64)}`;

test("INV-CHECKPOINT-01 commits immutable snapshot, group, and checkpoint atomically", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "nerve-unified-checkpoint-"));
  const store = new CanonicalStore(join(home, "nerve.sqlite"));
  await store.initialize();
  t.after(async () => {
    await store.close();
    await rm(home, { recursive: true, force: true });
  });
  const transition = buildAppendTransition({
    head: {
      schemaVersion: 1,
      conversationId: "conv_checkpoint",
      revision: 0,
      activeEntryId: null,
      selectionEpoch: 0,
      foregroundRunId: null,
    },
    identity: {
      commandId: "command_checkpoint",
      inputFingerprint: hash,
      actor: { kind: "agent" },
      cause: { kind: "suspension" },
      committedAt: "2026-09-12T00:00:00.000Z",
      transitionId: "transition_checkpoint",
    },
    entries: [
      {
        entryId: "entry_checkpoint",
        kind: "assistant_message",
        inlineContent: { text: "pending tool" },
        runId: "run_checkpoint",
      },
    ],
    foregroundRunId: "run_checkpoint",
  });
  const result = await store.commitConversationCommand({
    namespaceId: "namespace_test",
    executionIncarnationId: "incarnation_test",
    operationKind: "suspend",
    ownerKind: "conversation",
    ownerId: "conv_checkpoint",
    commandId: "command_checkpoint",
    fingerprintVersion: 1,
    fingerprint: hash,
    expectedHeads: [
      {
        conversationId: "conv_checkpoint",
        revision: 0,
        selectionEpoch: 0,
        createIfMissing: true,
      },
    ],
    transitions: [transition],
    artifactManifests: [
      {
        manifestId: "manifest_snapshot_checkpoint",
        schemaVersion: 1,
        data: { state: "suspended" },
      },
      {
        manifestId: "manifest_pending_checkpoint",
        schemaVersion: 1,
        data: { memberIds: ["member_checkpoint"] },
      },
    ],
    runControls: [
      {
        schemaVersion: 1,
        conversationId: "conv_checkpoint",
        runId: "run_checkpoint",
        generation: 1,
        boundSelectionEpoch: 0,
        continuationEntryId: "entry_checkpoint",
        checkpointId: "checkpoint_checkpoint",
        waitGroupId: "wait_group_checkpoint",
        providerPhaseId: null,
        state: "waiting",
        foregroundOwned: true,
        revision: 1,
      },
    ],
    executionSnapshots: [
      {
        schemaVersion: 1,
        snapshotId: "snapshot_checkpoint",
        runId: "run_checkpoint",
        compatibilityVersion: "test-v1",
        manifestId: "manifest_snapshot_checkpoint",
        digest: hash,
        modelContextRecipeVersion: 1,
        createdAt: "2026-09-12T00:00:00.000Z",
      },
    ],
    waitGroups: [
      {
        schemaVersion: 1,
        waitGroupId: "wait_group_checkpoint",
        runId: "run_checkpoint",
        membershipManifestId: "manifest_members_checkpoint",
        continuationEntryId: "entry_checkpoint",
        continuationConsumed: false,
        state: "open",
        revision: 1,
        members: [
          {
            schemaVersion: 1,
            memberId: "member_checkpoint",
            waitGroupId: "wait_group_checkpoint",
            memberKind: "tool",
            ownerId: "tool_checkpoint",
            inputFingerprint: hash,
            executionState: "awaiting_approval",
            attachmentDisposition: "pending",
            contributesToBarrier: false,
            revision: 1,
          },
        ],
      },
    ],
    checkpoints: [
      {
        schemaVersion: 1,
        checkpointId: "checkpoint_checkpoint",
        conversationId: "conv_checkpoint",
        runId: "run_checkpoint",
        agentId: "agent_checkpoint",
        captureRevision: 1,
        captureTransitionId: "transition_checkpoint",
        anchorEntryId: "entry_checkpoint",
        selectionEpoch: 0,
        runGeneration: 1,
        executionPhase: "waiting",
        snapshotId: "snapshot_checkpoint",
        pendingManifestId: "manifest_pending_checkpoint",
        waitGroupId: "wait_group_checkpoint",
        contextRecipeVersion: 1,
        integrityHash: hash,
        createdAt: "2026-09-12T00:00:00.000Z",
      },
    ],
    outcome: { checkpointId: "checkpoint_checkpoint" },
    publicationIntents: [],
    now: "2026-09-12T00:00:00.000Z",
  });
  assert.equal(result.kind, "committed");
  assert.equal(
    (await store.readTimelineRunControl("conv_checkpoint", "run_checkpoint"))
      ?.checkpointId,
    "checkpoint_checkpoint",
  );
});
