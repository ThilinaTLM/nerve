import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyConversationEvent,
  emptyConversationRenderState,
} from "./index.js";

describe("conversation-ui adapters", () => {
  it("applies live text and durable entry events", () => {
    let state = emptyConversationRenderState("conv_test");
    state = applyConversationEvent(state, {
      id: "evt_1",
      seq: 1,
      ts: "2026-01-01T00:00:00.000Z",
      type: "conversation.run.started",
      durability: "durable",
      data: {
        conversationId: "conv_test",
        agentId: "agent_test",
        runId: "run_test",
        projectId: "proj_test",
        startedAt: "2026-01-01T00:00:00.000Z",
      },
    });
    state = applyConversationEvent(state, {
      id: "evt_2",
      seq: 2,
      ts: "2026-01-01T00:00:01.000Z",
      type: "conversation.live.message.started",
      durability: "transient",
      data: {
        conversationId: "conv_test",
        agentId: "agent_test",
        projectId: "proj_test",
        runId: "run_test",
        turnId: "turn_test",
        liveMessageId: "msg_test",
        messageOrdinal: 0,
        startedAt: "2026-01-01T00:00:01.000Z",
      },
    });
    state = applyConversationEvent(state, {
      id: "evt_3",
      seq: 3,
      ts: "2026-01-01T00:00:02.000Z",
      type: "conversation.live.content.delta",
      durability: "transient",
      data: {
        conversationId: "conv_test",
        agentId: "agent_test",
        projectId: "proj_test",
        runId: "run_test",
        turnId: "turn_test",
        liveMessageId: "msg_test",
        contentBlockId: "block_test",
        contentIndex: 0,
        kind: "text",
        offset: 0,
        delta: "hello",
      },
    });
    assert.equal(
      (state.activeRun?.turns[0]?.messages[0]?.blocks[0] as { text?: string })
        ?.text,
      "hello",
    );
    state = applyConversationEvent(state, {
      id: "evt_4",
      seq: 4,
      ts: "2026-01-01T00:00:03.000Z",
      type: "conversation.entry.appended",
      durability: "durable",
      data: {
        conversationId: "conv_test",
        agentId: "agent_test",
        runId: "run_test",
        entry: {
          id: "entry_test",
          conversationId: "conv_test",
          agentId: "agent_test",
          runId: "run_test",
          role: "assistant",
          kind: "message",
          text: "hello",
          createdAt: "2026-01-01T00:00:03.000Z",
        },
      },
    });
    assert.equal(state.entries[0]?.id, "entry_test");
    assert.equal(state.cursorSeq, 4);
  });
});
