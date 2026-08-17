import type {
  ConversationSnapshot,
  ToolCallTranscriptRecord,
} from "@nervekit/contracts";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fromConversationSnapshot } from "./adapters.js";
import { buildConversationRenderProjection } from "./render.js";
import type { ConversationRenderState } from "./types.js";

const ts = "2026-07-07T00:00:00.000Z";

function toolCall(
  overrides: Partial<ToolCallTranscriptRecord> = {},
): ToolCallTranscriptRecord {
  return {
    id: "tool_bash",
    sourceToolCallId: "call_bash",
    providerToolCallId: "call_bash",
    conversationId: "conv_workbench",
    agentId: "agent_workbench",
    projectId: "proj_workbench",
    runId: "run_workbench",
    toolName: "bash",
    risk: "command",
    cwd: "/workspace",
    status: "completed",
    revision: 1,
    attempt: 1,
    interactions: [],
    createdAt: ts,
    updatedAt: ts,
    ...overrides,
  };
}

describe("conversation render projection", () => {
  it("keeps active-run text, tool cards, and trailing text in content-index order", () => {
    const state: ConversationRenderState = {
      conversationId: "conv_workbench",
      entries: [
        {
          id: "entry_user",
          conversationId: "conv_workbench",
          agentId: "agent_workbench",
          runId: "run_workbench",
          role: "user",
          kind: "message",
          text: "Run the tool",
          createdAt: ts,
        },
      ],
      activeEntryIds: ["entry_user"],
      toolCalls: [
        toolCall({
          turnId: "turn_workbench",
          liveMessageId: "msg_workbench",
          contentIndex: 1,
        }),
      ],
      activeRun: {
        runId: "run_workbench",
        agentId: "agent_workbench",
        projectId: "proj_workbench",
        conversationId: "conv_workbench",
        status: "running",
        startedAt: ts,
        turns: [
          {
            turnId: "turn_workbench",
            ordinal: 0,
            messages: [
              {
                liveMessageId: "msg_workbench",
                messageOrdinal: 0,
                startedAt: ts,
                blocks: [
                  {
                    kind: "text",
                    contentBlockId: "block_text_0",
                    contentIndex: 0,
                    text: "I will run it.",
                    done: true,
                  },
                  {
                    kind: "text",
                    contentBlockId: "block_text_2",
                    contentIndex: 2,
                    text: "Done.",
                    done: false,
                  },
                ],
              },
            ],
          },
        ],
        toolOutputsByToolCallId: {},
        queuedPrompts: [],
      },
      cursorSeq: 0,
    };

    const render = buildConversationRenderProjection(state);

    assert.deepEqual(
      render.timeline.map((item) => item.key),
      [
        "entry_user",
        "live:msg_workbench:text:0",
        "tool-slot:msg_workbench:1",
        "live:msg_workbench:text:2",
      ],
    );
    assert.equal(render.hasActiveTurnOutput, true);
  });

  it("excludes active-run live messages once the durable entry exists", () => {
    const snapshot: ConversationSnapshot = {
      conversation: {
        id: "conv_workbench",
        projectId: "proj_workbench",
        title: "Workbench",
        mode: "coding",
        permissionLevel: "supervised",
        approvalPolicy: { autoApproveReadOnly: true },
        createdAt: ts,
        updatedAt: ts,
      },
      tree: { conversationId: "conv_workbench", rootEntryIds: [], nodes: [] },
      entries: [
        {
          id: "entry_assistant",
          conversationId: "conv_workbench",
          agentId: "agent_workbench",
          runId: "run_workbench",
          turnId: "turn_workbench",
          liveMessageId: "msg_workbench",
          role: "assistant",
          kind: "message",
          text: "Durable answer",
          createdAt: ts,
        },
      ],
      activeEntryIds: ["entry_assistant"],
      toolCalls: [],
      activeRun: {
        runId: "run_workbench",
        agentId: "agent_workbench",
        projectId: "proj_workbench",
        conversationId: "conv_workbench",
        status: "running",
        startedAt: ts,
        turns: [
          {
            turnId: "turn_workbench",
            ordinal: 0,
            messages: [
              {
                liveMessageId: "msg_workbench",
                messageOrdinal: 0,
                startedAt: ts,
                blocks: [
                  {
                    kind: "text",
                    contentBlockId: "block_text_0",
                    contentIndex: 0,
                    text: "Durable answer",
                    done: true,
                  },
                ],
              },
            ],
          },
        ],
        toolOutputsByToolCallId: {},
        queuedPrompts: [],
      },
      cursorSeq: 0,
      generatedAt: ts,
    };

    // Snapshot ingestion drains materialized messages before projection.
    const render = buildConversationRenderProjection(
      fromConversationSnapshot(snapshot),
    );

    assert.deepEqual(
      render.timeline.map((item) => item.key),
      ["entry_assistant"],
    );
    assert.equal(render.streamingText, "");
    assert.equal(render.hasActiveTurnOutput, true);
  });

  it("scopes waiting state to the latest turn through materialization", () => {
    const firstMessage = {
      liveMessageId: "msg_first",
      messageOrdinal: 0,
      startedAt: ts,
      blocks: [
        {
          kind: "text" as const,
          contentBlockId: "block_first",
          contentIndex: 0,
          text: "I will use a tool.",
          done: true,
        },
      ],
    };
    const baseState: ConversationRenderState = {
      conversationId: "conv_workbench",
      entries: [],
      activeEntryIds: [],
      toolCalls: [],
      activeRun: {
        runId: "run_workbench",
        agentId: "agent_workbench",
        projectId: "proj_workbench",
        conversationId: "conv_workbench",
        status: "running",
        startedAt: ts,
        turns: [
          { turnId: "turn_first", ordinal: 0, messages: [firstMessage] },
          { turnId: "turn_second", ordinal: 1, messages: [] },
        ],
        toolOutputsByToolCallId: {},
        queuedPrompts: [],
      },
      cursorSeq: 0,
    };

    assert.equal(
      buildConversationRenderProjection(baseState).hasActiveTurnOutput,
      false,
      "prior output must not hide a second-turn wait",
    );

    const withSecondTurnOutput: ConversationRenderState = {
      ...baseState,
      activeRun: {
        ...baseState.activeRun!,
        turns: [
          baseState.activeRun!.turns[0],
          {
            turnId: "turn_second",
            ordinal: 1,
            messages: [
              {
                liveMessageId: "msg_second",
                messageOrdinal: 0,
                startedAt: ts,
                blocks: [
                  {
                    kind: "text",
                    contentBlockId: "block_second",
                    contentIndex: 0,
                    text: "Final answer",
                    done: true,
                  },
                ],
              },
            ],
          },
        ],
      },
    };
    assert.equal(
      buildConversationRenderProjection(withSecondTurnOutput)
        .hasActiveTurnOutput,
      true,
    );

    const materialized: ConversationRenderState = {
      ...baseState,
      entries: [
        {
          id: "entry_second",
          conversationId: "conv_workbench",
          agentId: "agent_workbench",
          runId: "run_workbench",
          turnId: "turn_second",
          liveMessageId: "msg_second",
          messageOrdinal: 0,
          role: "assistant",
          kind: "message",
          text: "Final answer",
          createdAt: ts,
        },
      ],
      activeEntryIds: ["entry_second"],
    };
    assert.equal(
      buildConversationRenderProjection(materialized).hasActiveTurnOutput,
      true,
      "durable final output must prevent a completion-time waiting flash",
    );
  });

  it("keeps terminal tool calls visible at their durable transcript anchor", () => {
    const state: ConversationRenderState = {
      conversationId: "conv_workbench",
      entries: [
        {
          id: "entry_user",
          conversationId: "conv_workbench",
          agentId: "agent_workbench",
          runId: "run_workbench",
          role: "user",
          kind: "message",
          text: "Run the tool",
          createdAt: ts,
        },
        {
          id: "entry_result",
          conversationId: "conv_workbench",
          agentId: "agent_workbench",
          runId: "run_workbench",
          role: "system",
          kind: "message",
          text: "[Tool result: bash]",
          details: {
            toolCallId: "call_bash",
            toolRecordId: "tool_bash",
            toolName: "bash",
          },
          createdAt: ts,
        },
      ],
      activeEntryIds: ["entry_user", "entry_result"],
      toolCalls: [toolCall()],
      cursorSeq: 0,
    };

    const render = buildConversationRenderProjection(state);

    assert.deepEqual(
      render.timeline.map((item) => item.key),
      ["entry_user", "tool:tool_bash"],
    );
  });
});
