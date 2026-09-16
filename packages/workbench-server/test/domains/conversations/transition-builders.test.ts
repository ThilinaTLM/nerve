import assert from "node:assert/strict";
import test from "node:test";
import { conversationTransitionSchema } from "@nervekit/contracts/conversations";
import {
  buildAppendTransition,
  buildControlTransition,
  buildSelectionTransition,
} from "../../../src/domains/conversations/timeline/transition-builders.js";
import { conversationCommandFingerprint } from "../../../src/domains/conversations/timeline/command-fingerprint.js";

const hash = `sha256:${"a".repeat(64)}`;
const identity = {
  commandId: "command_one",
  inputFingerprint: hash,
  actor: { kind: "user", id: "user_one" },
  cause: { kind: "request" },
  committedAt: "2026-09-12T00:00:00.000Z",
  transitionId: "transition_one",
};
const head = {
  schemaVersion: 1 as const,
  conversationId: "conv_one",
  revision: 7,
  activeEntryId: "entry_parent",
  selectionEpoch: 2,
  foregroundRunId: null,
};

test("INV-HEAD-01 constructs an explicit append chain and advances once", () => {
  const transition = buildAppendTransition({
    head,
    identity,
    entries: [
      { entryId: "entry_first", kind: "user_message", inlineContent: "one" },
      {
        entryId: "entry_second",
        kind: "assistant_message",
        inlineContent: "two",
      },
    ],
  });
  assert.equal(
    conversationTransitionSchema.safeParse(transition).success,
    true,
  );
  assert.equal(transition.entries[0]?.parentEntryId, "entry_parent");
  assert.equal(transition.entries[1]?.parentEntryId, "entry_first");
  assert.equal(transition.resultingHead.activeEntryId, "entry_second");
  assert.equal(transition.revision, 8);
  assert.equal(transition.resultingHead.selectionEpoch, 2);
});

test("INV-NAV-01 changes selection epoch, clears ownership, and appends nothing", () => {
  const transition = buildSelectionTransition({
    head: { ...head, foregroundRunId: "run_one" },
    targetEntryId: "entry_sibling",
    identity,
  });
  assert.equal(transition?.entries.length, 0);
  assert.equal(transition?.resultingHead.selectionEpoch, 3);
  assert.equal(transition?.resultingHead.foregroundRunId, null);
  assert.equal(
    buildSelectionTransition({
      head,
      targetEntryId: "entry_parent",
      identity,
    }),
    undefined,
  );
});

test("INV-HEAD-01 lifecycle-only transitions preserve the selected head", () => {
  const transition = buildControlTransition({
    head,
    kind: "run_changed",
    identity,
  });
  assert.equal(transition.entries.length, 0);
  assert.equal(transition.resultingHead.activeEntryId, head.activeEntryId);
  assert.equal(transition.resultingHead.selectionEpoch, head.selectionEpoch);
});

test("INV-RECEIPT-01 semantic fingerprints ignore object key order and undefined", () => {
  assert.equal(
    conversationCommandFingerprint({ b: 2, omitted: undefined, a: [1, 3] }),
    conversationCommandFingerprint({ a: [1, 3], b: 2 }),
  );
  assert.notEqual(
    conversationCommandFingerprint({ a: [1, 3], b: 2 }),
    conversationCommandFingerprint({ a: [3, 1], b: 2 }),
  );
});
