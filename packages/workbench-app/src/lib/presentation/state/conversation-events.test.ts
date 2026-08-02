import type {
  EventEnvelope,
  ToolCallTranscriptRecord,
} from "@nervekit/contracts";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyConversationEvent,
  buildConversationRenderProjection,
  emptyConversationRenderState,
} from "./index.js";

const ts = "2026-07-07T00:00:00.000Z";

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value))
    return value;
  Object.freeze(value);
  for (const child of Object.values(value as Record<string, unknown>)) {
    deepFreeze(child);
  }
  return value;
}

function evt(seq: number, type: string, data: unknown): EventEnvelope {
  return {
    id: `evt_${seq}`,
    seq,
    ts,
    type,
    data,
  };
}

function startRun(seq = 1): EventEnvelope {
  return evt(seq, "run.started", {
    conversationId: "conv_test",
    agentId: "agent_test",
    runId: "run_test",
    projectId: "proj_test",
    startedAt: ts,
  });
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
describe("conversation event reducer", () => {
  it("copy-on-write replaces only the live content ancestry", () => {
    let state = applyConversationEvent(
      applyConversationEvent(
        emptyConversationRenderState("conv_test"),
        startRun(),
      ),
      startMessage(),
    );
    state = applyConversationEvent(
      state,
      evt(3, "conversation.live.content.delta", {
        conversationId: "conv_test",
        agentId: "agent_test",
        projectId: "proj_test",
        runId: "run_test",
        turnId: "turn_test",
        liveMessageId: "msg_test",
        contentBlockId: "block_text",
        contentIndex: 0,
        kind: "text",
        offset: 0,
        delta: "hello",
      }),
    );
    const previous = deepFreeze(state);
    const previousRun = previous.activeRun!;
    const previousTurn = previousRun.turns[0]!;
    const previousMessage = previousTurn.messages[0]!;
    const previousBlock = previousMessage.blocks[0]!;
    const previousOutputs = previousRun.toolOutputsByToolCallId;

    const next = applyConversationEvent(
      previous,
      evt(4, "conversation.live.content.delta", {
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
    );

    assert.notEqual(next, previous);
    assert.notEqual(next.activeRun, previousRun);
    assert.notEqual(next.activeRun?.turns, previousRun.turns);
    assert.notEqual(next.activeRun?.turns[0], previousTurn);
    assert.notEqual(next.activeRun?.turns[0]?.messages[0], previousMessage);
    assert.notEqual(
      next.activeRun?.turns[0]?.messages[0]?.blocks[0],
      previousBlock,
    );
    assert.equal(next.activeRun?.toolOutputsByToolCallId, previousOutputs);
    assert.equal(
      next.activeRun?.turns[0]?.messages[0]?.blocks[0]?.kind === "text"
        ? next.activeRun.turns[0].messages[0].blocks[0].text
        : undefined,
      "hello world",
    );
    assert.equal(
      previousBlock.kind === "text" ? previousBlock.text : undefined,
      "hello",
    );
  });

  it("consumed render-neutral events retain every nested reference", () => {
    const state = applyConversationEvent(
      emptyConversationRenderState("conv_test"),
      startRun(),
    );
    const next = applyConversationEvent(
      state,
      evt(2, "run.checkpointed", { conversationId: "conv_test" }),
      { consumeUnhandled: true },
    );
    assert.notEqual(next, state);
    assert.equal(next.cursorSeq, 2);
    assert.equal(next.activeRun, state.activeRun);
    assert.equal(next.entries, state.entries);
    assert.equal(next.toolCalls, state.toolCalls);
  });

  it("keeps the draft block and joins it with the durable tool call", () => {
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
    const draftBlocks = () =>
      state.activeRun?.turns[0]?.messages[0]?.blocks.filter(
        (block) => block.kind === "tool_call_draft",
      ) ?? [];
    assert.equal(draftBlocks().length, 1);

    state = applyConversationEvent(
      state,
      evt(4, "toolCall.updated", {
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
      }),
    );

    // The draft block survives for the presentation handoff; the timeline
    // joins draft and record into one node with a stable slot key.
    assert.equal(draftBlocks().length, 1);
    assert.equal(state.toolCalls[0]?.id, "tool_test");
    const render = buildConversationRenderProjection(state);
    const toolNodes = render.timeline.filter((item) => item.kind === "tool");
    assert.equal(toolNodes.length, 1);
    assert.equal(toolNodes[0]?.key, "tool-slot:msg_test:1");
    if (toolNodes[0]?.kind === "tool") {
      assert.equal(toolNodes[0].toolCall?.id, "tool_test");
      assert.equal(toolNodes[0].draft?.block.toolName, "bash");
    }
  });

  it("keeps one tool-slot node through materialization, approval, execution, and commit", () => {
    let state = emptyConversationRenderState("conv_test");
    const assertOneSlot = () => {
      const tools = buildConversationRenderProjection(state).timeline.filter(
        (item) => item.kind === "tool",
      );
      assert.equal(tools.length, 1);
      assert.equal(tools[0]?.key, "tool-slot:msg_test:1");
    };

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
    state = applyConversationEvent(
      state,
      evt(4, "conversation.live.tool_draft.delta", {
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
        offset: 0,
        delta: '{"command":"pwd"}',
      }),
    );
    state = applyConversationEvent(
      state,
      evt(5, "conversation.live.tool_draft.done", {
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
        args: { command: "pwd" },
      }),
    );
    assertOneSlot();

    // The durable assistant entry lands before the durable tool record. The
    // envelope supplies exact correlation even though the entry omits it.
    state = applyConversationEvent(
      state,
      evt(2, "conversation.entry.appended", {
        conversationId: "conv_test",
        liveMessageId: "msg_test",
        entry: {
          id: "entry_assistant",
          conversationId: "conv_test",
          agentId: "agent_test",
          runId: "run_test",
          turnId: "turn_test",
          messageOrdinal: 0,
          role: "assistant",
          kind: "message",
          text: "[Tool call: bash]",
          createdAt: ts,
        },
      }),
    );
    assert.deepEqual(
      state.activeRun?.turns[0]?.messages[0]?.blocks.map((block) => block.kind),
      ["tool_call_draft"],
    );
    assertOneSlot();

    const updateTool = (
      seq: number,
      status: ToolCallTranscriptRecord["status"],
    ) => {
      state = applyConversationEvent(
        state,
        evt(seq, "toolCall.updated", {
          conversationId: "conv_test",
          agentId: "agent_test",
          projectId: "proj_test",
          runId: "run_test",
          providerToolCallId: "call_test",
          toolCall: toolCall({
            status,
            turnId: "turn_test",
            liveMessageId: "msg_test",
            contentIndex: 1,
            updatedAt: `2026-07-07T00:00:0${seq}.000Z`,
          }),
        }),
      );
      assertOneSlot();
    };
    updateTool(3, "requested");
    updateTool(4, "pending_approval");
    updateTool(5, "running");
    updateTool(6, "completed");

    state = applyConversationEvent(
      state,
      evt(7, "conversation.entry.appended", {
        conversationId: "conv_test",
        entry: {
          id: "entry_tool_result",
          conversationId: "conv_test",
          agentId: "agent_test",
          runId: "run_test",
          role: "system",
          kind: "message",
          text: "/workspace",
          details: {
            toolCallId: "call_test",
            toolRecordId: "tool_test",
            toolName: "bash",
          },
          createdAt: ts,
        },
      }),
    );
    assertOneSlot();

    state = applyConversationEvent(
      state,
      evt(8, "run.completed", {
        conversationId: "conv_test",
        agentId: "agent_test",
        projectId: "proj_test",
        runId: "run_test",
        completedAt: ts,
      }),
    );
    assert.equal(state.activeRun, undefined);
    assertOneSlot();
  });

  it("hides every failed attempt across consecutive retries of one run", () => {
    let state = emptyConversationRenderState("conv_test");
    state.entries = ["entry_failed_1", "entry_failed_2"].map((id) => ({
      id,
      conversationId: "conv_test",
      agentId: "agent_test",
      runId: "run_test",
      role: "assistant" as const,
      kind: "message" as const,
      text: "failed",
      details: { stopReason: "error", errorMessage: "rate limited" },
      createdAt: ts,
    }));
    state.activeEntryIds = ["entry_failed_1", "entry_failed_2"];
    const retrying = (seq: number, attempt: number, failedEntryId: string) =>
      evt(seq, "run.retrying", {
        conversationId: "conv_test",
        agentId: "agent_test",
        projectId: "proj_test",
        runId: "run_test",
        attempt,
        maxRetries: 3,
        delayMs: 100,
        retryAt: ts,
        errorMessage: "rate limited",
        failedEntryId,
      });
    state = applyConversationEvent(state, retrying(1, 1, "entry_failed_1"));
    state = applyConversationEvent(state, retrying(2, 2, "entry_failed_2"));

    const render = buildConversationRenderProjection(state);
    assert.deepEqual(
      render.timeline.map((item) => item.kind),
      ["run_status"],
    );

    // The failures stay hidden while the successful attempt streams.
    state = applyConversationEvent(state, startMessage(3));
    assert.equal(state.activeRun?.status, "running");
    assert.equal(state.activeRun?.retry, undefined);
    const streaming = buildConversationRenderProjection(state);
    assert.equal(
      streaming.timeline.some(
        (item) => item.kind === "message" && item.item.text === "failed",
      ),
      false,
    );
  });

  it("resumes a HITL continuation without rendering retry status", () => {
    let state = applyConversationEvent(
      emptyConversationRenderState("conv_test"),
      startRun(),
    );
    state = applyConversationEvent(
      state,
      evt(2, "run.retrying", {
        conversationId: "conv_test",
        agentId: "agent_test",
        projectId: "proj_test",
        runId: "run_test",
        attempt: 1,
        maxRetries: 3,
        delayMs: 100,
        retryAt: ts,
        errorMessage: "rate limited",
      }),
    );
    state = applyConversationEvent(
      state,
      evt(3, "run.resumed", {
        conversationId: "conv_test",
        agentId: "agent_test",
        projectId: "proj_test",
        runId: "run_test",
        attempt: 2,
        resumeKind: "interaction",
        resumedAt: ts,
      }),
    );

    assert.equal(state.activeRun?.status, "running");
    assert.equal(state.activeRun?.retry, undefined);
    assert.equal(state.sending, true);
    assert.equal(
      buildConversationRenderProjection(state).timeline.some(
        (item) => item.kind === "run_status",
      ),
      false,
    );
  });

  it("ignores stale durable events without rewinding state", () => {
    const state = emptyConversationRenderState("conv_test");
    state.cursorSeq = 5;

    const next = applyConversationEvent(
      state,
      evt(5, "conversation.entry.appended", {
        conversationId: "conv_test",
        entry: {
          id: "entry_stale",
          conversationId: "conv_test",
          role: "user",
          kind: "message",
          text: "stale",
          createdAt: ts,
        },
      }),
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
    const block = state.activeRun?.turns[0]?.messages[0]?.blocks[0];
    assert.equal(
      block && block.kind !== "tool_call_draft" ? block.text : undefined,
      "hello world",
    );
  });

  it("tracks streaming compaction previews and drops stale snapshots", () => {
    const compactionEvent = (
      seq: number,
      type: string,
      data: Record<string, unknown>,
    ) =>
      evt(seq, type, {
        conversationId: "conv_test",
        agentId: "agent_test",
        runId: "run_test",
        reason: "threshold",
        ...data,
      });

    let state = emptyConversationRenderState("conv_test");
    state = applyConversationEvent(state, startRun());
    state = applyConversationEvent(
      state,
      compactionEvent(2, "conversation.compaction.started", { startedAt: ts }),
    );
    state = applyConversationEvent(
      state,
      compactionEvent(3, "conversation.compaction.progress", {
        sequence: 2,
        attempt: 1,
        preview: "## Goal\nFinish",
        generatedLines: 2,
        generatedChars: 14,
      }),
    );

    assert.equal(state.transient?.compaction?.state, "running");
    assert.equal(
      state.transient?.compaction?.summaryPreview,
      "## Goal\nFinish",
    );
    assert.equal(state.transient?.compaction?.generatedLines, 2);

    state = applyConversationEvent(
      state,
      compactionEvent(4, "conversation.compaction.progress", {
        sequence: 1,
        attempt: 1,
        preview: "stale",
        generatedLines: 1,
        generatedChars: 5,
      }),
    );
    assert.equal(
      state.transient?.compaction?.summaryPreview,
      "## Goal\nFinish",
    );

    state = applyConversationEvent(
      state,
      compactionEvent(5, "conversation.compaction.cancelled", {
        cancelledAt: ts,
      }),
    );
    assert.equal(state.transient?.compaction?.state, "cancelled");
    assert.equal(state.transient?.compaction?.summaryPreview, undefined);

    state = applyConversationEvent(
      state,
      compactionEvent(6, "conversation.compaction.progress", {
        sequence: 9,
        attempt: 2,
        preview: "late",
        generatedLines: 1,
        generatedChars: 4,
      }),
    );
    assert.equal(state.transient?.compaction?.state, "cancelled");
    assert.equal(state.transient?.compaction?.summaryPreview, undefined);
  });

  it("consumes reference-only compaction completion before snapshot refresh", () => {
    let state = emptyConversationRenderState("conv_test");
    state = applyConversationEvent(
      state,
      evt(1, "conversation.compaction.started", {
        conversationId: "conv_test",
        runId: "run_test",
        reason: "manual",
        startedAt: ts,
      }),
    );
    state = applyConversationEvent(
      state,
      evt(2, "conversation.compacted", {
        conversationId: "conv_test",
        entryId: "entry_compaction",
        tokensBefore: 20_000,
        firstKeptEntryId: "entry_recent",
        reason: "manual",
      }),
    );

    assert.equal(state.transient?.compaction, undefined);
    assert.equal(state.entries.length, 0);
    assert.equal(state.cursorSeq, 2);
  });

  it("starts a running compaction notice from a progress snapshot alone", () => {
    let state = emptyConversationRenderState("conv_test");
    state = applyConversationEvent(
      state,
      evt(1, "conversation.compaction.progress", {
        conversationId: "conv_test",
        agentId: "agent_test",
        runId: "run_test",
        reason: "threshold",
        sequence: 7,
        attempt: 1,
        preview: "## Goal",
        generatedLines: 1,
        generatedChars: 7,
      }),
    );

    assert.equal(state.transient?.compaction?.state, "running");
    assert.equal(state.transient?.compaction?.previewSequence, 7);
    assert.equal(
      state.transient?.compaction?.id,
      "live:compaction:run_test:threshold",
    );
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
    assert.deepEqual(state.activeRun?.turns, []);
  });
});
