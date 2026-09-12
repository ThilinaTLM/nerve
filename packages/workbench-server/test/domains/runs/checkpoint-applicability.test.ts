import assert from "node:assert/strict";
import test from "node:test";
import type {
  CanonicalCheckpoint,
  RunControl,
  WaitGroup,
  WaitGroupMember,
} from "@nervekit/contracts/runs";
import type { ConversationHead } from "@nervekit/contracts/conversations";
import {
  evaluateCheckpointApplicability,
  type TimelineAncestryPort,
} from "../../../src/domains/runs/runtime/checkpoint-applicability.js";

const hash = `sha256:${"a".repeat(64)}`;
const checkpoint: CanonicalCheckpoint = {
  schemaVersion: 1,
  checkpointId: "checkpoint_one",
  conversationId: "conv_one",
  runId: "run_one",
  agentId: "agent_one",
  captureRevision: 4,
  captureTransitionId: "transition_four",
  anchorEntryId: "entry_anchor",
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
const head: ConversationHead = {
  schemaVersion: 1,
  conversationId: "conv_one",
  revision: 6,
  activeEntryId: "entry_result",
  selectionEpoch: 2,
  foregroundRunId: "run_one",
};
const run: RunControl = {
  schemaVersion: 1,
  conversationId: "conv_one",
  runId: "run_one",
  generation: 1,
  boundSelectionEpoch: 2,
  continuationEntryId: "entry_result",
  checkpointId: "checkpoint_one",
  waitGroupId: "wait_group_one",
  providerPhaseId: null,
  state: "waiting",
  foregroundOwned: true,
  revision: 2,
};
const member: WaitGroupMember = {
  schemaVersion: 1,
  memberId: "member_one",
  waitGroupId: "wait_group_one",
  memberKind: "tool",
  ownerId: "tool_one",
  inputFingerprint: hash,
  policyFingerprint: hash,
  executionState: "awaiting_approval",
  attachmentDisposition: "pending",
  contributesToBarrier: false,
  revision: 1,
};
const group: WaitGroup = {
  schemaVersion: 1,
  waitGroupId: "wait_group_one",
  runId: "run_one",
  membershipManifestId: "manifest_members",
  continuationEntryId: "entry_result",
  continuationConsumed: false,
  state: "open",
  revision: 2,
  members: [member],
};
const ancestry: TimelineAncestryPort = {
  isAncestor: async () => true,
};

function input() {
  return {
    checkpoint,
    head,
    run,
    group,
    member,
    expectedInputFingerprint: hash,
    expectedPolicyFingerprint: hash,
    policyStillValid: true,
    snapshotCompatible: true,
    advancesCompatible: true,
  };
}

test("INV-CHECKPOINT-01 applies by canonical fences and ancestry", async () => {
  assert.deepEqual(await evaluateCheckpointApplicability(input(), ancestry), {
    kind: "applicable",
  });
});

test("INV-CHECKPOINT-01 navigation away and back cannot revive an old epoch", async () => {
  const changed = input();
  changed.head = { ...head, selectionEpoch: 4 };
  assert.deepEqual(await evaluateCheckpointApplicability(changed, ancestry), {
    kind: "inapplicable",
    reason: "selection_mismatch",
  });
});

test("INV-CHECKPOINT-01 permits revision advances but rejects incompatible history", async () => {
  const advanced = input();
  advanced.head = { ...head, revision: 100 };
  assert.equal(
    (await evaluateCheckpointApplicability(advanced, ancestry)).kind,
    "applicable",
  );
  advanced.advancesCompatible = false;
  assert.deepEqual(await evaluateCheckpointApplicability(advanced, ancestry), {
    kind: "inapplicable",
    reason: "incompatible_advance",
  });
});

test("INV-CHECKPOINT-01 rejects a checkpoint anchor outside continuation ancestry", async () => {
  assert.deepEqual(
    await evaluateCheckpointApplicability(input(), {
      isAncestor: async () => false,
    }),
    { kind: "inapplicable", reason: "anchor_not_ancestor" },
  );
});
