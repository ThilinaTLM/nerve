import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { updateConversationStateRequestSchema } from "../../src/index.js";
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
