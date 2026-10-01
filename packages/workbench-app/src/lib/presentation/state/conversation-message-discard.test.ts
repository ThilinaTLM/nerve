import assert from "node:assert/strict";
import { it } from "node:test";
import {
  applyConversationEvent,
  emptyConversationRenderState,
} from "./index.js";

it("discards only the abandoned live message, preserving committed text and subsequent drafts", () => {
  const ts = "2026-01-01T00:00:00.000Z";
  const identity = {
    conversationId: "conv_test",
    agentId: "agent_test",
    projectId: "proj_test",
    runId: "run_test",
    turnId: "turn_test",
    liveMessageId: "msg_old",
  };
  let seq = 0;
  let state = emptyConversationRenderState("conv_test");
  const apply = (type: string, data: unknown) => {
    state = applyConversationEvent(state, {
      id: `evt_${++seq}`,
      seq,
      ts,
      type,
      data,
    });
  };
  apply("conversation.live.message.started", {
    ...identity,
    messageOrdinal: 0,
    startedAt: ts,
  });
  apply("conversation.live.content.delta", {
    ...identity,
    contentBlockId: "block_text",
    contentIndex: 0,
    kind: "text",
    offset: 0,
    delta: "abandoned prose",
  });
  apply("conversation.live.tool_draft.started", {
    ...identity,
    contentBlockId: "block_tool",
    contentIndex: 1,
    toolName: "write",
    providerToolCallId: "provider_old",
  });
  state.entries = [
    {
      id: "entry_kept",
      conversationId: "conv_test",
      agentId: "agent_test",
      role: "assistant",
      kind: "message",
      text: "Already committed",
      createdAt: ts,
    },
  ];
  apply("conversation.live.message.started", {
    ...identity,
    liveMessageId: "msg_new",
    messageOrdinal: 1,
    startedAt: ts,
  });
  const previous = state;
  apply("conversation.live.message.discarded", {
    ...identity,
    runId: "run_other",
  });
  assert.equal(state.activeRun?.turns[0]?.messages.length, 2);
  apply("conversation.live.message.discarded", identity);
  apply("conversation.live.message.discarded", identity);
  assert.deepEqual(
    state.activeRun?.turns[0]?.messages.map((message) => message.liveMessageId),
    ["msg_new"],
  );
  assert.equal(previous.activeRun?.turns[0]?.messages.length, 2);
  assert.equal(state.entries[0]?.text, "Already committed");
});
