import assert from "node:assert/strict";
import test from "node:test";
import { conversationStream } from "@nervekit/contracts/events";
import {
  getConversationSnapshotResponse,
  getWorkspaceSnapshotResponse,
} from "../../../src/adapters/protocol/snapshots.js";

test("conversation snapshot is a read-only cursor-consistent query", async () => {
  const conversationId = "conv_test";
  const order: string[] = [];
  const state = {
    events: {
      withCursor: async (stream: string, action: () => Promise<unknown>) => {
        assert.equal(stream, conversationStream(conversationId));
        order.push("cursor:start");
        const value = await action();
        order.push("cursor:end");
        return {
          value,
          cursor: { stream, processedSeq: 42, earliestSeq: 1 },
        };
      },
    },
    conversationQuery: {
      getConversationSnapshot: async (scope: string) => {
        assert.equal(scope, conversationId);
        order.push("query");
        return {
          conversation: { id: conversationId },
          activity: {
            conversationId: scope,
            activeAgentId: "agent_test",
            state: "awaiting_async",
            pendingInteractionCount: 0,
            pendingAsyncCount: 1,
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
        };
      },
    },
  };

  const response = await getConversationSnapshotResponse(
    state as never,
    conversationId,
  );

  assert.deepEqual(order, ["cursor:start", "query", "cursor:end"]);
  assert.equal(response.snapshot.cursorSeq, 42);
  assert.equal(response.snapshot.activity.state, "awaiting_async");
  assert.equal(response.cursor.streams[0]?.processedSeq, 42);
});

test("workspace snapshot includes batched server-owned activity", async () => {
  const state = {
    events: {
      withCursor: async (_stream: string, action: () => Promise<unknown>) => ({
        value: await action(),
        cursor: { stream: "workspace", processedSeq: 2, earliestSeq: 1 },
      }),
    },
    projectLifecycle: { listProjects: () => [] },
    conversationLifecycle: { listConversations: () => [] },
    agentLifecycle: { listAgents: () => [] },
    tasks: { listTasks: () => [] },
    tools: { listToolCallPreviews: async () => [] },
    agentActivity: {
      workspaceActivity: async () => ({
        agentActivities: [],
        conversationActivities: [
          {
            conversationId: "conv_test",
            state: "idle",
            pendingInteractionCount: 0,
            pendingAsyncCount: 0,
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
        ],
      }),
    },
  };
  const response = await getWorkspaceSnapshotResponse(state as never);
  assert.equal(response.snapshot.conversationActivities.length, 1);
});
