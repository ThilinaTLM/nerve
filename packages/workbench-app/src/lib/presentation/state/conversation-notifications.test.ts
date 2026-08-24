import type { EventEnvelope, NotifyEvent } from "@nervekit/contracts";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyConversationEvent,
  applyConversationNotification,
  emptyConversationRenderState,
} from "./index.js";

const ts = "2026-07-07T00:00:00.000Z";
const liveBase = {
  conversationId: "conv_test",
  agentId: "agent_test",
  projectId: "proj_test",
  runId: "run_test",
};

function notify(type: string, data: unknown): NotifyEvent {
  return { id: `notify_${type}`, ts, type, data };
}

function startRun(): EventEnvelope {
  return {
    id: "evt_1",
    seq: 1,
    ts,
    type: "run.started",
    data: { ...liveBase, conversationRevision: 5, startedAt: ts },
  };
}

describe("conversation live notifications", () => {
  it("applies Bash, Python, and Explore output only while their run is active", () => {
    const cases = [
      { toolName: "bash", delta: "bash tick 1\n" },
      { toolName: "python_exec", delta: "python tick 1\n" },
      {
        toolName: "explore",
        delta: `${JSON.stringify({ type: "explore_progress", phase: "started" })}\n`,
      },
    ];

    for (const [index, testCase] of cases.entries()) {
      let state = applyConversationEvent(
        emptyConversationRenderState("conv_test"),
        startRun(),
      );
      const toolCallId = `tool_test_${index}`;
      const output = notify("conversation.live.tool_output.delta", {
        ...liveBase,
        conversationRevision: 9,
        toolCallId,
        toolName: testCase.toolName,
        stream: "stdout",
        offset: 0,
        delta: testCase.delta,
      });

      let gaps = 0;
      state = applyConversationNotification(state, output, {
        onGap: () => gaps++,
      });
      assert.equal(
        state.activeRun?.toolOutputsByToolCallId[toolCallId]?.text,
        testCase.delta,
        testCase.toolName,
      );
      assert.equal(state.cursorSeq, 1);
      assert.equal(state.conversationRevision, 5);
      assert.equal(gaps, 0);

      const staleOutput = notify("conversation.live.tool_output.delta", {
        ...liveBase,
        conversationRevision: 4,
        toolCallId: `${toolCallId}_stale`,
        toolName: testCase.toolName,
        stream: "stdout",
        offset: 0,
        delta: "stale\n",
      });
      assert.equal(applyConversationNotification(state, staleOutput), state);

      state = applyConversationEvent(state, {
        id: "evt_2",
        seq: 2,
        ts,
        type: "run.completed",
        data: { ...liveBase, conversationRevision: 10, completedAt: ts },
      });
      assert.equal(applyConversationNotification(state, output), state);
    }
  });

  it("applies full live detail without advancing the durable cursor", () => {
    let state = applyConversationEvent(
      emptyConversationRenderState("conv_test"),
      startRun(),
    );
    state = applyConversationNotification(
      state,
      notify("conversation.live.message.started", {
        ...liveBase,
        turnId: "turn_test",
        liveMessageId: "msg_test",
        messageOrdinal: 0,
        startedAt: ts,
      }),
    );
    state = applyConversationNotification(
      state,
      notify("conversation.live.content.delta", {
        ...liveBase,
        turnId: "turn_test",
        liveMessageId: "msg_test",
        contentBlockId: "block_text",
        contentIndex: 0,
        kind: "text",
        offset: 0,
        delta: "complete live detail",
      }),
    );
    assert.equal(state.cursorSeq, 1);
    const block = state.activeRun?.turns[0]?.messages[0]?.blocks[0];
    assert.equal(
      block?.kind === "text" ? block.text : undefined,
      "complete live detail",
    );

    const stale = applyConversationNotification(
      state,
      notify("conversation.live.content.delta", {
        ...liveBase,
        runId: "run_old",
        turnId: "turn_test",
        liveMessageId: "msg_test",
        contentBlockId: "block_text",
        contentIndex: 0,
        kind: "text",
        offset: 20,
        delta: "ignored",
      }),
    );
    assert.equal(stale, state);
  });
});
