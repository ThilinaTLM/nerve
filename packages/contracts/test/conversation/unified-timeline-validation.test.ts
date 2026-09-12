import assert from "node:assert/strict";
import test from "node:test";
import {
  canonicalCheckpointSchema,
  waitGroupSchema,
} from "../../src/domains/runs/unified-execution.js";
import {
  conversationTransitionSchema,
  timelinePageRequestSchema,
} from "../../src/domains/conversations/timeline.js";
import { mutationOutcomeSchema } from "../../src/domains/conversations/timeline-outcomes.js";

const hash = `sha256:${"a".repeat(64)}`;

test("INV-ID-01 validates immutable entry ownership and transition order", () => {
  const value = {
    schemaVersion: 1,
    transitionId: "transition_one",
    conversationId: "conv_one",
    revision: 1,
    kind: "entries_appended",
    commandId: "command-one",
    inputFingerprint: hash,
    actor: { kind: "user" },
    cause: { kind: "prompt" },
    committedAt: "2026-09-12T00:00:00.000Z",
    entries: [
      {
        schemaVersion: 1,
        entryId: "entry_one",
        conversationId: "conv_one",
        transitionId: "transition_one",
        ordinal: 0,
        parentEntryId: null,
        kind: "user_message",
        inlineContent: { text: "hello" },
        artifacts: [],
        provenance: {},
      },
    ],
    evidenceReferences: [],
    resultingHead: {
      schemaVersion: 1,
      conversationId: "conv_one",
      revision: 1,
      activeEntryId: "entry_one",
      selectionEpoch: 0,
      foregroundRunId: null,
    },
  };
  assert.equal(conversationTransitionSchema.safeParse(value).success, true);
  assert.equal(
    conversationTransitionSchema.safeParse({
      ...value,
      entries: [{ ...value.entries[0], conversationId: "other" }],
    }).success,
    false,
  );
});

test("INV-CHECKPOINT-01 excludes transcript and harness leaf authority", () => {
  const checkpoint = {
    schemaVersion: 1,
    checkpointId: "checkpoint_one",
    conversationId: "conv_one",
    runId: "run_one",
    agentId: "agent_one",
    captureRevision: 4,
    captureTransitionId: "transition_four",
    anchorEntryId: "entry_four",
    selectionEpoch: 2,
    runGeneration: 1,
    executionPhase: "suspension",
    snapshotId: "snapshot_one",
    pendingManifestId: "manifest_pending",
    waitGroupId: "wait_group_one",
    contextRecipeVersion: 1,
    integrityHash: hash,
    createdAt: "2026-09-12T00:00:00.000Z",
  };
  assert.equal(canonicalCheckpointSchema.safeParse(checkpoint).success, true);
  const keys = Object.keys(canonicalCheckpointSchema.shape);
  assert.equal(keys.includes("entryIds"), false);
  assert.equal(keys.includes("transcriptCursor"), false);
  assert.equal(keys.includes("harnessLeafId"), false);
});

test("INV-BARRIER-01 bounds wait groups before commitment", () => {
  const member = (index: number) => ({
    schemaVersion: 1,
    memberId: `member_${index}`,
    waitGroupId: "wait_group_one",
    memberKind: "tool",
    ownerId: `tool_${index}`,
    inputFingerprint: hash,
    executionState: "drafted",
    attachmentDisposition: "pending",
    contributesToBarrier: false,
    revision: 1,
  });
  const group = {
    schemaVersion: 1,
    waitGroupId: "wait_group_one",
    runId: "run_one",
    membershipManifestId: "manifest_one",
    continuationEntryId: "entry_one",
    continuationConsumed: false,
    state: "open",
    revision: 1,
    members: Array.from({ length: 32 }, (_, index) => member(index)),
  };
  assert.equal(waitGroupSchema.safeParse(group).success, true);
  assert.equal(
    waitGroupSchema.safeParse({
      ...group,
      members: [...group.members, member(32)],
    }).success,
    false,
  );
});

test("INV-OUTCOME-01 keeps replay and conflicts discriminated", () => {
  assert.equal(
    mutationOutcomeSchema.safeParse({
      kind: "receipt_replay",
      positions: [],
      value: { accepted: true },
    }).success,
    true,
  );
  assert.equal(
    mutationOutcomeSchema.safeParse({
      kind: "cas_conflict",
      current: [{ conversationId: "conv_one", revision: 2 }],
      retry: "reload_and_revalidate",
    }).success,
    true,
  );
});

test("INV-PAGE-01 enforces bounded page requests", () => {
  assert.equal(
    timelinePageRequestSchema.safeParse({
      conversationId: "conv_one",
      pageSize: 200,
    }).success,
    true,
  );
  assert.equal(
    timelinePageRequestSchema.safeParse({
      conversationId: "conv_one",
      pageSize: 201,
    }).success,
    false,
  );
});
