import assert from "node:assert/strict";
import test from "node:test";
import type {
  ConversationHead,
  ConversationTransition,
} from "@nervekit/contracts/conversations";
import { validateTransitionHeadChange } from "../../../src/domains/conversations/timeline/transition-validation.js";

const hash = `sha256:${"a".repeat(64)}`;
const current: ConversationHead = {
  schemaVersion: 1,
  conversationId: "conv_one",
  revision: 4,
  activeEntryId: "entry_four",
  selectionEpoch: 2,
  foregroundRunId: "run_one",
};

function base(kind: ConversationTransition["kind"]): ConversationTransition {
  return {
    schemaVersion: 1,
    transitionId: "transition_five",
    conversationId: "conv_one",
    revision: 5,
    kind,
    commandId: "command_five",
    inputFingerprint: hash,
    actor: {},
    cause: {},
    committedAt: "2026-09-12T00:00:00.000Z",
    entries: [],
    evidenceReferences: [],
    resultingHead: { ...current, revision: 5 },
  };
}

test("INV-HEAD-01 navigation increments epoch and fences the owner", () => {
  const navigation = base("selection_changed");
  navigation.resultingHead = {
    ...navigation.resultingHead,
    activeEntryId: "entry_two",
    selectionEpoch: 3,
    foregroundRunId: null,
  };
  assert.doesNotThrow(() => validateTransitionHeadChange(current, navigation));

  const returnWithoutNewEpoch = {
    ...navigation,
    resultingHead: {
      ...navigation.resultingHead,
      activeEntryId: "entry_two",
      selectionEpoch: 2,
    },
  };
  assert.throws(
    () => validateTransitionHeadChange(current, returnWithoutNewEpoch),
    /increment/,
  );
});

test("INV-HEAD-01 ordinary append advances through one explicit chain", () => {
  const append = base("entries_appended");
  append.entries = [
    {
      schemaVersion: 1,
      entryId: "entry_five_a",
      conversationId: "conv_one",
      transitionId: "transition_five",
      ordinal: 0,
      parentEntryId: "entry_four",
      kind: "assistant_message",
      artifacts: [],
      provenance: {},
    },
    {
      schemaVersion: 1,
      entryId: "entry_five_b",
      conversationId: "conv_one",
      transitionId: "transition_five",
      ordinal: 1,
      parentEntryId: "entry_five_a",
      kind: "tool_proposal",
      artifacts: [],
      provenance: {},
    },
  ];
  append.resultingHead = {
    ...append.resultingHead,
    activeEntryId: "entry_five_b",
  };
  assert.doesNotThrow(() => validateTransitionHeadChange(current, append));

  append.entries[1]!.parentEntryId = "entry_four";
  assert.throws(
    () => validateTransitionHeadChange(current, append),
    /form a chain/,
  );
});

test("INV-HEAD-01 lifecycle-only transitions cannot move heads", () => {
  const lifecycle = base("run_changed");
  lifecycle.resultingHead = {
    ...lifecycle.resultingHead,
    activeEntryId: "entry_other",
  };
  assert.throws(
    () => validateTransitionHeadChange(current, lifecycle),
    /cannot move/,
  );
});
