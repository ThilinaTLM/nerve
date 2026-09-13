import assert from "node:assert/strict";
import test from "node:test";
import type { CanonicalContextSnapshot } from "../../../src/domains/conversations/timeline/canonical-conversation-context.service.js";
import { createCanonicalHarnessContext } from "../../../src/domains/agents/execution/canonical-harness-context.js";

function snapshot(): CanonicalContextSnapshot {
  return {
    namespaceId: "namespace_context",
    executionIncarnationId: "incarnation_context",
    conversationId: "conv_context",
    runId: "run_context",
    runGeneration: 1,
    runRevision: 2,
    sourceEntryId: "entry_tool",
    sourceRevision: 2,
    selectionEpoch: 0,
    entries: [
      {
        schemaVersion: 1,
        entryId: "entry_user",
        conversationId: "conv_context",
        transitionId: "transition_user",
        ordinal: 0,
        parentEntryId: null,
        kind: "user_message",
        inlineContent: { text: "hello" },
        artifacts: [],
        provenance: { createdAt: "2026-09-14T00:00:00.000Z" },
      },
      {
        schemaVersion: 1,
        entryId: "entry_tool",
        conversationId: "conv_context",
        transitionId: "transition_tool",
        ordinal: 0,
        parentEntryId: "entry_user",
        kind: "tool_result",
        inlineContent: {
          exactHarnessMessage: {
            role: "toolResult",
            toolCallId: "call_1",
            toolName: "read",
            isError: false,
            content: [{ type: "text", text: "result" }],
          },
        },
        artifacts: [],
        provenance: { createdAt: "2026-09-14T00:00:01.000Z" },
      },
    ],
  };
}

test("canonical harness context is disposable and preserves exact provider messages", async () => {
  const storage = createCanonicalHarnessContext({
    snapshot: snapshot(),
    createdAt: "2026-09-14T00:00:00.000Z",
  });
  const entries = await storage.getEntries();
  assert.equal(entries.length, 2);
  assert.deepEqual(
    entries[1]?.type === "message" ? entries[1].message : undefined,
    {
      role: "toolResult",
      toolCallId: "call_1",
      toolName: "read",
      isError: false,
      content: [{ type: "text", text: "result" }],
    },
  );
  await storage.appendEntry({
    type: "message",
    id: "entry_ephemeral",
    parentId: "entry_tool",
    timestamp: "2026-09-14T00:00:02.000Z",
    message: { role: "user", content: "memory only", timestamp: 0 },
  });
  assert.equal((await storage.getEntries()).length, 3);
  assert.equal(snapshot().entries.length, 2);
});

test("canonical harness context fails closed for lossy tool history", () => {
  const value = snapshot();
  value.entries[1] = {
    ...value.entries[1]!,
    inlineContent: { text: "flattened" },
  };
  assert.throws(
    () =>
      createCanonicalHarnessContext({
        snapshot: value,
        createdAt: "2026-09-14T00:00:00.000Z",
      }),
    /lacks an exact harness message/,
  );
});
