import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ConversationQueryService } from "../../../src/domains/conversations/conversation-query.service.js";

const timestamp = "2026-08-23T00:00:00.000Z";

describe("ConversationQueryService", () => {
  it("does not restore tools from an active run outside the selected branch", async () => {
    const conversation = {
      id: "conv_test",
      projectId: "proj_test",
      title: "Test",
      mode: "coding",
      permissionLevel: "standard",
      activeEntryId: "entry_selected",
      createdAt: timestamp,
      updatedAt: timestamp,
    } as never;
    const entries = [
      {
        id: "entry_selected",
        conversationId: "conv_test",
        runId: "run_old_branch",
        role: "user",
        kind: "message",
        text: "branch here",
        createdAt: timestamp,
      },
      {
        id: "entry_anchored_result",
        conversationId: "conv_test",
        role: "system",
        kind: "message",
        text: "[Tool result]",
        details: { toolRecordId: "tool_anchored" },
        createdAt: timestamp,
      },
    ] as never;
    const tools = [
      {
        id: "tool_old_branch",
        conversationId: "conv_test",
        runId: "run_old_branch",
        status: "completed",
        hidden: false,
      },
      {
        id: "tool_anchored",
        conversationId: "conv_test",
        runId: "run_anchored",
        status: "completed",
        hidden: false,
      },
    ] as never;
    const service = new ConversationQueryService({
      events: { latestSeq: async () => 0 } as never,
      state: { getConversation: () => conversation } as never,
      getConversationEntries: () => entries,
      getConversationRevision: async () => 3,
      getConversationTree: () =>
        ({
          conversationId: "conv_test",
          activeEntryId: "entry_selected",
          rootEntryIds: ["entry_selected"],
          nodes: [],
        }) as never,
      getContextUsage: async () => undefined as never,
      listToolCallPreviews: () => tools,
      getActiveRun: async (_conversationId, activeEntryIds) => {
        assert.deepEqual(activeEntryIds, [
          "entry_selected",
          "entry_anchored_result",
        ]);
        return undefined;
      },
    });

    const snapshot = await service.getConversationSnapshot("conv_test");

    assert.deepEqual(
      snapshot.toolCalls.map((toolCall) => toolCall.id),
      ["tool_anchored"],
    );
  });
});
