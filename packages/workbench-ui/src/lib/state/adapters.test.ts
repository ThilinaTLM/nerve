import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ConversationSnapshot, EventEnvelope } from "@nervekit/contracts";
import {
  applyConversationEvent,
  buildConversationRenderProjection,
  type ConversationRenderState,
  emptyConversationRenderState,
  fromConversationSnapshot,
} from "./index.js";

describe("shared conversation adapters", () => {
  it("preserves tool-call previews across lifecycle updates", () => {
    let state = emptyConversationRenderState("conv_test");
    const base = {
      id: "tool_test",
      sourceToolCallId: "call_raw",
      providerToolCallId: "call_raw",
      conversationId: "conv_test",
      agentId: "agent_test",
      projectId: "proj_test",
      runId: "run_test",
      toolName: "bash" as const,
      risk: "command" as const,
      cwd: "/workspace",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };

    state = applyConversationEvent(state, {
      id: "evt_tool_1",
      seq: 1,
      ts: "2026-01-01T00:00:00.000Z",
      type: "toolCall.updated",
      durability: "durable",
      data: {
        conversationId: "conv_test",
        agentId: "agent_test",
        projectId: "proj_test",
        runId: "run_test",
        providerToolCallId: "call_raw",
        toolCall: {
          ...base,
          status: "requested",
          turnId: "turn_test",
          liveMessageId: "msg_test",
          contentIndex: 1,
          argsPreview: { command: "echo hello" },
        },
      },
    });

    state = applyConversationEvent(state, {
      id: "evt_tool_2",
      seq: 2,
      ts: "2026-01-01T00:00:01.000Z",
      type: "toolCall.updated",
      durability: "durable",
      data: {
        conversationId: "conv_test",
        agentId: "agent_test",
        projectId: "proj_test",
        runId: "run_test",
        providerToolCallId: "call_raw",
        toolCall: {
          ...base,
          status: "completed",
          resultPreview: { content: "hello\n", exitCode: 0 },
          updatedAt: "2026-01-01T00:00:01.000Z",
        },
      },
    });

    assert.deepEqual(state.toolCalls[0]?.argsPreview, {
      command: "echo hello",
    });
    assert.deepEqual(state.toolCalls[0]?.resultPreview, {
      content: "hello\n",
      exitCode: 0,
    });
    assert.equal(state.toolCalls[0]?.status, "completed");
    assert.equal(state.toolCalls[0]?.turnId, "turn_test");
    assert.equal(state.toolCalls[0]?.liveMessageId, "msg_test");
    assert.equal(state.toolCalls[0]?.contentIndex, 1);
  });

  it("applies live text and durable entry events", () => {
    let state = emptyConversationRenderState("conv_test");
    state = applyConversationEvent(state, {
      id: "evt_1",
      seq: 1,
      ts: "2026-01-01T00:00:00.000Z",
      type: "run.started",
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

  it("drains stale thinking by ordinal watermark when liveMessageId misses", () => {
    // Regression: reasoning blocks used to strand in the live tail (below all
    // newer committed content) whenever the persisted entry's liveMessageId
    // failed to correlate with the streamed message.
    let seq = 0;
    let state = emptyConversationRenderState("conv_test");
    const base = {
      conversationId: "conv_test",
      agentId: "agent_test",
      projectId: "proj_test",
      runId: "run_test",
    };
    const apply = (
      type: string,
      data: Record<string, unknown>,
      durability: "durable" | "transient" = "transient",
    ) => {
      seq += 1;
      state = applyConversationEvent(state, {
        id: `evt_${seq}`,
        seq,
        ts: `2026-01-01T00:00:${String(seq).padStart(2, "0")}.000Z`,
        type,
        durability,
        data,
      } as EventEnvelope);
    };
    const streamMessage = (
      liveMessageId: string,
      messageOrdinal: number,
      thinking: string,
    ) => {
      apply("conversation.live.message.started", {
        ...base,
        turnId: "turn_test",
        liveMessageId,
        messageOrdinal,
        startedAt: `2026-01-01T00:00:${String(seq + 1).padStart(2, "0")}.000Z`,
      });
      apply("conversation.live.content.delta", {
        ...base,
        turnId: "turn_test",
        liveMessageId,
        contentBlockId: `block_${liveMessageId}`,
        contentIndex: 0,
        kind: "thinking",
        offset: 0,
        delta: thinking,
      });
      apply("conversation.live.content.done", {
        ...base,
        turnId: "turn_test",
        liveMessageId,
        contentBlockId: `block_${liveMessageId}`,
        contentIndex: 0,
        kind: "thinking",
        finalText: thinking,
      });
    };

    apply(
      "run.started",
      { ...base, startedAt: "2026-01-01T00:00:00.000Z" },
      "durable",
    );

    streamMessage("msg_1", 0, "thinking about A");
    // Entry materializes msg_1 but without its liveMessageId (correlation
    // miss); only turnId + messageOrdinal identify the message.
    apply(
      "conversation.entry.appended",
      {
        conversationId: "conv_test",
        entry: {
          id: "entry_a1",
          conversationId: "conv_test",
          agentId: "agent_test",
          runId: "run_test",
          turnId: "turn_test",
          messageOrdinal: 0,
          role: "assistant",
          kind: "message",
          text: "Answer A",
          details: { thinkingBlocks: [{ text: "thinking about A" }] },
          createdAt: "2026-01-01T00:00:04.000Z",
        },
      },
      "durable",
    );

    streamMessage("msg_2", 1, "thinking about B");

    const projection = buildConversationRenderProjection(
      state as ConversationRenderState,
    );
    const rendered = projection.timeline.map((node) =>
      node.kind === "message"
        ? `${node.item.displayKind}:${node.item.text}`
        : node.kind,
    );
    // The stale copy of "thinking about A" must not trail the timeline; only
    // msg_2's live thinking may follow the committed entry.
    assert.deepEqual(rendered, [
      "thinking:thinking about A",
      "message:Answer A",
      "thinking:thinking about B",
    ]);

    // A snapshot-style recovery must not resurrect it either: even when the
    // server snapshot still carries the materialized message (persistence /
    // materialization race), ingestion drains it against the snapshot entries.
    const rendered2 = state as ConversationRenderState;
    const snapshot: ConversationSnapshot = {
      conversation: {
        id: "conv_test",
        projectId: "proj_test",
        title: "Test",
        mode: "coding",
        permissionLevel: "supervised",
        approvalPolicy: { autoApproveReadOnly: true },
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      entries: rendered2.entries,
      activeEntryIds: rendered2.activeEntryIds,
      tree: {
        conversationId: "conv_test",
        rootEntryIds: [],
        nodes: [],
      },
      toolCalls: [],
      activeRun: {
        ...(rendered2.activeRun as NonNullable<
          ConversationRenderState["activeRun"]
        >),
        // Simulate a stale snapshot that still carries the materialized
        // message alongside the streaming one.
        turns: [
          {
            turnId: "turn_test",
            ordinal: 0,
            messages: [
              {
                liveMessageId: "msg_1",
                messageOrdinal: 0,
                startedAt: "2026-01-01T00:00:01.000Z",
                blocks: [
                  {
                    kind: "thinking",
                    contentBlockId: "block_msg_1",
                    contentIndex: 0,
                    text: "thinking about A",
                    done: true,
                  },
                  {
                    kind: "tool_call_draft",
                    contentBlockId: "block_tool_msg_1",
                    contentIndex: 1,
                    providerToolCallId: "provider_pending",
                    toolName: "read",
                    argsText: "",
                    args: { path: "package.json" },
                    done: true,
                  },
                ],
              },
              {
                liveMessageId: "msg_2",
                messageOrdinal: 1,
                startedAt: "2026-01-01T00:00:05.000Z",
                blocks: [
                  {
                    kind: "thinking",
                    contentBlockId: "block_msg_2",
                    contentIndex: 0,
                    text: "thinking about B",
                    done: true,
                  },
                ],
              },
            ],
          },
        ],
      },
      cursorSeq: 10,
      generatedAt: "2026-01-01T00:00:06.000Z",
    };
    const rebuilt = buildConversationRenderProjection(
      fromConversationSnapshot(snapshot),
    );
    const rebuiltRendered = rebuilt.timeline.map((node) =>
      node.kind === "message"
        ? `${node.item.displayKind}:${node.item.text}`
        : node.kind,
    );
    assert.deepEqual(rebuiltRendered, [
      "thinking:thinking about A",
      "message:Answer A",
      "tool",
      "thinking:thinking about B",
    ]);
  });
});
