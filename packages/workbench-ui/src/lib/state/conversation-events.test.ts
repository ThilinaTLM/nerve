import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
  EventEnvelope,
  QueuedPromptRecord,
  ToolCallTranscriptRecord,
} from "@nervekit/contracts";
import {
  applyConversationEvent,
  buildConversationRenderProjection,
  emptyConversationRenderState,
} from "./index.js";

const ts = "2026-07-07T00:00:00.000Z";

function evt(
  seq: number,
  type: string,
  data: unknown,
  durability: "durable" | "transient" = "transient",
): EventEnvelope {
  return {
    id: `evt_${seq}`,
    seq,
    ts,
    type,
    durability,
    data,
  };
}

function startRun(seq = 1): EventEnvelope {
  return evt(
    seq,
    "run.started",
    {
      conversationId: "conv_test",
      agentId: "agent_test",
      runId: "run_test",
      projectId: "proj_test",
      startedAt: ts,
    },
    "durable",
  );
}

function startMessage(seq = 2): EventEnvelope {
  return evt(seq, "conversation.live.message.started", {
    conversationId: "conv_test",
    agentId: "agent_test",
    projectId: "proj_test",
    runId: "run_test",
    turnId: "turn_test",
    liveMessageId: "msg_test",
    messageOrdinal: 0,
    startedAt: ts,
  });
}

function toolCall(
  overrides: Partial<ToolCallTranscriptRecord> = {},
): ToolCallTranscriptRecord {
  return {
    id: "tool_test",
    sourceToolCallId: "call_test",
    providerToolCallId: "call_test",
    conversationId: "conv_test",
    agentId: "agent_test",
    projectId: "proj_test",
    runId: "run_test",
    toolName: "bash",
    risk: "command",
    cwd: "/workspace",
    status: "running",
    createdAt: ts,
    updatedAt: ts,
    ...overrides,
  };
}

function queuedPrompt(overrides: Partial<QueuedPromptRecord> = {}) {
  return {
    id: "promptq_test",
    agentId: "agent_test",
    conversationId: "conv_test",
    projectId: "proj_test",
    runId: "run_test",
    behavior: "steer",
    text: "queued",
    status: "queued",
    createdAt: ts,
    updatedAt: ts,
    ...overrides,
  } satisfies QueuedPromptRecord;
}

describe("conversation event reducer", () => {
  it("caps live tool output and exposes tail output limits", () => {
    let state = emptyConversationRenderState("conv_test");
    state = applyConversationEvent(state, startRun());
    state = applyConversationEvent(
      state,
      evt(2, "conversation.live.tool_output.delta", {
        conversationId: "conv_test",
        agentId: "agent_test",
        projectId: "proj_test",
        runId: "run_test",
        toolCallId: "tool_test",
        toolName: "bash",
        stream: "combined",
        offset: 0,
        delta: "x".repeat(33_000),
      }),
    );

    const output = state.live?.toolOutputByToolCallId.tool_test;
    assert.equal(output?.text.length, 32_000);
    assert.equal(output?.outputLimits?.capped, true);
    assert.equal(output?.outputLimits?.totalChars, 33_000);
    assert.equal(output?.outputLimits?.omittedChars, 1_000);
  });

  it("updates and discards tool draft progress", () => {
    let state = emptyConversationRenderState("conv_test");
    state = applyConversationEvent(state, startRun());
    state = applyConversationEvent(state, startMessage());
    state = applyConversationEvent(
      state,
      evt(3, "conversation.live.tool_draft.started", {
        conversationId: "conv_test",
        agentId: "agent_test",
        projectId: "proj_test",
        runId: "run_test",
        turnId: "turn_test",
        liveMessageId: "msg_test",
        contentBlockId: "block_tool",
        contentIndex: 1,
        providerToolCallId: "call_test",
        toolName: "edit",
      }),
    );
    state = applyConversationEvent(
      state,
      evt(4, "conversation.live.tool_draft.progress", {
        conversationId: "conv_test",
        agentId: "agent_test",
        projectId: "proj_test",
        runId: "run_test",
        turnId: "turn_test",
        liveMessageId: "msg_test",
        contentBlockId: "block_tool",
        contentIndex: 1,
        providerToolCallId: "call_test",
        toolName: "edit",
        progress: { path: "src/app.ts", estimated: false, lineCount: 3 },
      }),
    );

    assert.equal(state.live?.toolDrafts[0]?.progress?.path, "src/app.ts");

    state = applyConversationEvent(
      state,
      evt(5, "conversation.live.tool_draft.discarded", {
        conversationId: "conv_test",
        agentId: "agent_test",
        projectId: "proj_test",
        runId: "run_test",
        turnId: "turn_test",
        liveMessageId: "msg_test",
        contentBlockId: "block_tool",
        contentIndex: 1,
        providerToolCallId: "call_test",
        toolName: "edit",
        reason: "abandoned",
      }),
    );

    assert.deepEqual(state.live?.toolDrafts, []);
  });

  it("removes matching live tool drafts when the durable tool call arrives", () => {
    let state = emptyConversationRenderState("conv_test");
    state = applyConversationEvent(state, startRun());
    state = applyConversationEvent(state, startMessage());
    state = applyConversationEvent(
      state,
      evt(3, "conversation.live.tool_draft.started", {
        conversationId: "conv_test",
        agentId: "agent_test",
        projectId: "proj_test",
        runId: "run_test",
        turnId: "turn_test",
        liveMessageId: "msg_test",
        contentBlockId: "block_tool",
        contentIndex: 1,
        providerToolCallId: "call_test",
        toolName: "bash",
      }),
    );
    assert.equal(state.live?.toolDrafts.length, 1);

    state = applyConversationEvent(
      state,
      evt(
        2,
        "toolCall.updated",
        {
          conversationId: "conv_test",
          agentId: "agent_test",
          projectId: "proj_test",
          runId: "run_test",
          providerToolCallId: "call_test",
          toolCall: toolCall({
            providerToolCallId: "call_test",
            turnId: "turn_test",
            liveMessageId: "msg_test",
            contentIndex: 1,
          }),
        },
        "durable",
      ),
    );

    assert.deepEqual(state.live?.toolDrafts, []);
    assert.equal(state.toolCalls[0]?.id, "tool_test");
  });

  it("updates queued prompts from prompt queue events", () => {
    let state = emptyConversationRenderState("conv_test");
    state = applyConversationEvent(state, startRun());
    const prompt = queuedPrompt();
    state = applyConversationEvent(
      state,
      evt(
        2,
        "conversation.prompt.queued",
        {
          conversationId: "conv_test",
          agentId: "agent_test",
          projectId: "proj_test",
          runId: "run_test",
          queuedPrompt: prompt,
        },
        "durable",
      ),
    );
    assert.equal(state.queuedPrompts?.length, 1);
    assert.equal(state.activeRun?.queuedPrompts.length, 1);

    state = applyConversationEvent(
      state,
      evt(
        3,
        "conversation.prompt.dequeued",
        {
          conversationId: "conv_test",
          agentId: "agent_test",
          projectId: "proj_test",
          runId: "run_test",
          queuedPrompt: prompt,
        },
        "durable",
      ),
    );
    assert.deepEqual(state.queuedPrompts, []);
    assert.deepEqual(state.activeRun?.queuedPrompts, []);
  });

  it("renders retry status and hides the failed entry", () => {
    let state = emptyConversationRenderState("conv_test");
    state.entries = [
      {
        id: "entry_failed",
        conversationId: "conv_test",
        agentId: "agent_test",
        runId: "run_test",
        role: "assistant",
        kind: "message",
        text: "failed",
        createdAt: ts,
      },
    ];
    state.activeEntryIds = ["entry_failed"];
    state = applyConversationEvent(
      state,
      evt(
        1,
        "run.retrying",
        {
          conversationId: "conv_test",
          agentId: "agent_test",
          projectId: "proj_test",
          runId: "run_test",
          attempt: 2,
          maxRetries: 3,
          delayMs: 100,
          retryAt: ts,
          errorMessage: "rate limited",
          failedEntryId: "entry_failed",
        },
        "durable",
      ),
    );

    const render = buildConversationRenderProjection(state);
    assert.deepEqual(
      render.timeline.map((item) => item.kind),
      ["run_status"],
    );
    assert.equal(render.timeline[0]?.key, "run-status:run_test");
  });

  it("ignores stale durable events without rewinding state", () => {
    const state = emptyConversationRenderState("conv_test");
    state.cursorSeq = 5;

    const next = applyConversationEvent(
      state,
      evt(
        5,
        "conversation.entry.appended",
        {
          conversationId: "conv_test",
          entry: {
            id: "entry_stale",
            conversationId: "conv_test",
            role: "user",
            kind: "message",
            text: "stale",
            createdAt: ts,
          },
        },
        "durable",
      ),
    );

    assert.equal(next, state);
    assert.deepEqual(next.entries, []);
    assert.equal(next.cursorSeq, 5);
  });

  it("continues live deltas from an activeRun snapshot without a gap", () => {
    let state = emptyConversationRenderState("conv_test");
    state.activeRun = {
      runId: "run_test",
      agentId: "agent_test",
      projectId: "proj_test",
      conversationId: "conv_test",
      status: "running",
      startedAt: ts,
      turns: [
        {
          turnId: "turn_test",
          ordinal: 0,
          messages: [
            {
              liveMessageId: "msg_test",
              messageOrdinal: 0,
              startedAt: ts,
              blocks: [
                {
                  kind: "text",
                  contentBlockId: "block_text",
                  contentIndex: 0,
                  text: "hello",
                  done: false,
                },
              ],
            },
          ],
        },
      ],
      toolOutputsByToolCallId: {},
      queuedPrompts: [],
    };
    let gapCalled = false;

    state = applyConversationEvent(
      state,
      evt(1, "conversation.live.content.delta", {
        conversationId: "conv_test",
        agentId: "agent_test",
        projectId: "proj_test",
        runId: "run_test",
        turnId: "turn_test",
        liveMessageId: "msg_test",
        contentBlockId: "block_text",
        contentIndex: 0,
        kind: "text",
        offset: 5,
        delta: " world",
      }),
      { onGap: () => (gapCalled = true) },
    );

    assert.equal(gapCalled, false);
    assert.equal(state.live?.messages[0]?.text, "hello world");
  });

  it("calls the snapshot recovery hook on offset gaps", () => {
    let state = emptyConversationRenderState("conv_test");
    state = applyConversationEvent(state, startRun());
    let gap:
      | { conversationId?: string; runId?: string; type: string }
      | undefined;

    state = applyConversationEvent(
      state,
      evt(2, "conversation.live.content.delta", {
        conversationId: "conv_test",
        agentId: "agent_test",
        projectId: "proj_test",
        runId: "run_test",
        turnId: "turn_test",
        liveMessageId: "msg_test",
        contentBlockId: "block_text",
        contentIndex: 0,
        kind: "text",
        offset: 5,
        delta: "world",
      }),
      { onGap: (reason) => (gap = reason) },
    );

    assert.deepEqual(gap, {
      conversationId: "conv_test",
      runId: "run_test",
      type: "conversation.live.content.delta",
    });
    assert.deepEqual(state.live?.messages, []);
  });
});
