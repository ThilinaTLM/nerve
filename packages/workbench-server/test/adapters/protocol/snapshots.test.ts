import assert from "node:assert/strict";
import test from "node:test";
import { conversationStream } from "@nervekit/contracts/events";
import { getConversationSnapshotResponse } from "../../../src/adapters/protocol/snapshots.js";

test("conversation snapshot is read-only and never starts approval work", async () => {
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
    humanInput: {
      recoverReadyApprovalBatches: async (scope?: string) => {
        assert.equal(scope, conversationId);
        order.push("reconcile");
      },
    },
    conversationQuery: {
      getConversationSnapshot: async (scope: string) => {
        assert.equal(scope, conversationId);
        order.push("query");
        return { conversation: { id: conversationId } };
      },
    },
  };

  const response = await getConversationSnapshotResponse(
    state as never,
    conversationId,
  );

  assert.deepEqual(order, ["cursor:start", "query", "cursor:end"]);
  assert.equal(response.snapshot.cursorSeq, 42);
  assert.equal(response.cursor.streams[0]?.processedSeq, 42);
});
