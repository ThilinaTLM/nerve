import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  conversationEntrySchema,
  updateConversationStateRequestSchema,
} from "../../src/domains/conversations/index.js";
import { conversationsOperationDefinitions } from "../../src/domains/conversations/operations.js";

const conversation = {
  id: "conv_01HN0000000000000000000000",
  projectId: "proj_01HN0000000000000000000000",
  title: "Conversation",
  mode: "coding",
  permissionLevel: "autonomous",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

describe("conversation state schemas", () => {
  it("accepts typed system provenance and legacy entries without rewriting their kind", () => {
    const base = {
      id: "entry_test",
      conversationId: conversation.id,
      role: "system",
      text: "notice",
      createdAt: conversation.createdAt,
    };
    for (const kind of [
      "tool_result",
      "inline_command_result",
      "subagent_run_event",
      "task_event",
      "run_status",
      "compaction",
      "branch_summary",
      "explore_report",
      "message",
    ]) {
      assert.equal(conversationEntrySchema.parse({ ...base, kind }).kind, kind);
    }
    assert.equal(conversationEntrySchema.parse(base).kind, "message");
    assert.equal(
      conversationEntrySchema.parse({
        ...base,
        kind: "message",
        details: { type: "subagent_event" },
      }).kind,
      "message",
    );
    assert.equal(
      conversationEntrySchema.safeParse({ ...base, kind: "unknown_event" })
        .success,
      false,
    );
  });

  it("requires at least one state mutation", () => {
    assert.equal(
      updateConversationStateRequestSchema.safeParse({}).success,
      false,
    );
    assert.equal(
      updateConversationStateRequestSchema.safeParse({ pinned: true }).success,
      true,
    );
    assert.equal(
      updateConversationStateRequestSchema.safeParse({ completed: false })
        .success,
      true,
    );
    assert.equal(
      updateConversationStateRequestSchema.safeParse({
        clearRuntimeStatus: true,
      }).success,
      true,
    );

    const operation = conversationsOperationDefinitions.find(
      (definition) => definition.method === "conversation.state.update",
    );
    assert.ok(operation);
    assert.equal(
      operation.paramsSchema.safeParse({ conversationId: conversation.id })
        .success,
      false,
    );
  });
});
