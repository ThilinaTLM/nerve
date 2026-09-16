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

test("canonical tool-result rows preserve their tool record anchor", () => {
  const projected = projectCanonicalTimelineEntry({
    ...assistant,
    entryId: "entry_tool_result",
    kind: "tool_result",
    toolCallId: "tool_projection",
  });
  assert.equal(
    (projected.details as { toolRecordId?: string }).toolRecordId,
    "tool_projection",
  );
});

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
