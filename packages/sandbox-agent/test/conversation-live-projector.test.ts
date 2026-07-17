import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ConversationEventType } from "@nervekit/contracts";
import { SandboxConversationLiveProjector } from "../src/run/conversation-live-projector.js";

type Published = {
  type: ConversationEventType;
  data: Readonly<Record<string, unknown>>;
};

function assistant(content: unknown[]) {
  return {
    role: "assistant",
    content,
    api: "test",
    provider: "nerve-scripted",
    model: "scripted-fast",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp: Date.now(),
  };
}

describe("SandboxConversationLiveProjector", () => {
  it("publishes live prose and tool drafts with one stable message anchor", () => {
    const published: Published[] = [];
    const projector = new SandboxConversationLiveProjector(
      {
        conversationId: "conv_live",
        agentId: "agent_live",
        projectId: "proj_live",
        runId: "run_live",
      },
      (type, data) => published.push({ type, data }),
    );

    projector.startTurn();
    projector.startAssistantMessage();
    projector.updateAssistantMessage({
      type: "message_update",
      message: assistant([{ type: "text", text: "Hel" }]),
      assistantMessageEvent: {
        type: "text_delta",
        contentIndex: 0,
        delta: "Hel",
        partial: assistant([{ type: "text", text: "Hel" }]),
      },
    } as never);
    projector.updateAssistantMessage({
      type: "message_update",
      message: assistant([{ type: "text", text: "Hello" }]),
      assistantMessageEvent: {
        type: "text_delta",
        contentIndex: 0,
        delta: "lo",
        partial: assistant([{ type: "text", text: "Hello" }]),
      },
    } as never);
    projector.updateAssistantMessage({
      type: "message_update",
      message: assistant([{ type: "text", text: "Hello" }]),
      assistantMessageEvent: {
        type: "text_end",
        contentIndex: 0,
        content: "Hello",
        partial: assistant([{ type: "text", text: "Hello" }]),
      },
    } as never);

    const tool = { type: "toolCall", id: "provider_1", name: "bash" };
    projector.updateAssistantMessage({
      type: "message_update",
      message: assistant([tool]),
      assistantMessageEvent: {
        type: "toolcall_start",
        contentIndex: 1,
        partial: assistant([{}, tool]),
      },
    } as never);
    projector.updateAssistantMessage({
      type: "message_update",
      message: assistant([tool]),
      assistantMessageEvent: {
        type: "toolcall_delta",
        contentIndex: 1,
        delta: '{"command":"pwd"}',
        partial: assistant([{}, tool]),
      },
    } as never);
    projector.updateAssistantMessage({
      type: "message_update",
      message: assistant([tool]),
      assistantMessageEvent: {
        type: "toolcall_end",
        contentIndex: 1,
        toolCall: { ...tool, arguments: { command: "pwd" } },
        partial: assistant([{}, tool]),
      },
    } as never);
    projector.publishToolOutput("provider_1", "tool_live", "bash", {
      content: [{ type: "text", text: "sandbox\n" }],
      details: { kind: "output", stream: "stdout", chunk: "sandbox\n" },
    });

    assert.deepEqual(
      published.map((event) => event.type),
      [
        "conversation.live.turn.started",
        "conversation.live.message.started",
        "conversation.live.content.delta",
        "conversation.live.content.delta",
        "conversation.live.content.done",
        "conversation.live.tool_draft.started",
        "conversation.live.tool_draft.delta",
        "conversation.live.tool_draft.done",
        "conversation.live.tool_output.delta",
      ],
    );
    assert.deepEqual(
      published
        .filter((event) => event.type === "conversation.live.content.delta")
        .map((event) => event.data.offset),
      [0, 3],
    );

    const output = published.at(-1)?.data;
    assert.equal(output?.stream, "stdout");
    assert.equal(output?.delta, "sandbox\n");

    const turnStarted = published[0].data;
    const started = published[1].data;
    assert.equal(turnStarted.turnId, started.turnId);
    assert.equal(turnStarted.ordinal, 0);
    const anchor = projector.resolveToolAnchor("provider_1");
    assert.equal(anchor?.turnId, started.turnId);
    assert.equal(anchor?.liveMessageId, started.liveMessageId);
    assert.equal(anchor?.contentIndex, 1);
    assert.deepEqual(projector.materializeAssistantMessage(), {
      turnId: started.turnId,
      liveMessageId: started.liveMessageId,
      messageOrdinal: 0,
    });
  });
});
