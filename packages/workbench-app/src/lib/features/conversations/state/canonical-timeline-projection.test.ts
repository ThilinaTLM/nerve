import assert from "node:assert/strict";
import test from "node:test";
import {
  projectCanonicalTimelineEntry,
  projectCanonicalTree,
} from "./canonical-timeline-projection.js";

const assistant = {
  schemaVersion: 1 as const,
  entryId: "entry_assistant",
  conversationId: "conv_projection",
  transitionId: "transition_projection",
  ordinal: 1,
  parentEntryId: "entry_user",
  kind: "assistant_message" as const,
  inlineContent: {
    exactHarnessMessage: {
      role: "assistant",
      content: [{ type: "text", text: "canonical response" }],
    },
  },
  artifacts: [],
  provenance: {
    agentId: "agent_projection",
    createdAt: "2026-09-14T00:00:00.000Z",
  },
};

test("INV-OUTCOME-01 projects only canonical page rows into transcript state", () => {
  const projected = projectCanonicalTimelineEntry(assistant);
  assert.equal(projected.text, "canonical response");
  assert.equal(projected.role, "assistant");
  const tree = projectCanonicalTree([
    {
      ...assistant,
      entryId: "entry_user",
      parentEntryId: null,
      kind: "user_message",
      ordinal: 0,
    },
    assistant,
  ]);
  assert.deepEqual(tree[0]?.childEntryIds, ["entry_assistant"]);
});
