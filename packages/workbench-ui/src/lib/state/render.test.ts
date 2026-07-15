import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
  ConversationSnapshot,
  ToolCallTranscriptRecord,
} from "@nervekit/contracts";
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
    conversationId: "conv_sandbox",
    agentId: "agent_sandbox",
    projectId: "proj_sandbox",
    runId: "run_sandbox",
    toolName: "bash",
    risk: "command",
    cwd: "/workspace",
    status: "completed",
    createdAt: ts,
    updatedAt: ts,
    ...overrides,
  };
}

describe("conversation render projection", () => {
  it("keeps active-run text, tool cards, and trailing text in content-index order", () => {
    const state: ConversationRenderState = {
      conversationId: "conv_sandbox",
      entries: [
        {
          id: "entry_user",
          conversationId: "conv_sandbox",
          agentId: "agent_sandbox",
          runId: "run_sandbox",
          role: "user",
          kind: "message",
          text: "Run the tool",
          createdAt: ts,
        },
      ],
      activeEntryIds: ["entry_user"],
      toolCalls: [
        toolCall({
          turnId: "turn_sandbox",
          liveMessageId: "msg_sandbox",
          contentIndex: 1,
        }),
      ],
      activeRun: {
        runId: "run_sandbox",
        agentId: "agent_sandbox",
        projectId: "proj_sandbox",
        conversationId: "conv_sandbox",
        status: "running",
        startedAt: ts,
        turns: [
          {
            turnId: "turn_sandbox",
            ordinal: 0,
            messages: [
              {
                liveMessageId: "msg_sandbox",
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
        "live:msg_sandbox:text:0",
        "tool-slot:msg_sandbox:1",
        "live:msg_sandbox:text:2",
      ],
    );
  });

  it("excludes active-run live messages once the durable entry exists", () => {
    const snapshot: ConversationSnapshot = {
      conversation: {
        id: "conv_sandbox",
        projectId: "proj_sandbox",
        title: "Sandbox",
        mode: "coding",
        permissionLevel: "supervised",
        approvalPolicy: { autoApproveReadOnly: true },
        createdAt: ts,
        updatedAt: ts,
      },
      tree: { conversationId: "conv_sandbox", rootEntryIds: [], nodes: [] },
      entries: [
        {
          id: "entry_assistant",
          conversationId: "conv_sandbox",
          agentId: "agent_sandbox",
          runId: "run_sandbox",
          turnId: "turn_sandbox",
          liveMessageId: "msg_sandbox",
          role: "assistant",
          kind: "message",
          text: "Durable answer",
          createdAt: ts,
        },
      ],
      activeEntryIds: ["entry_assistant"],
      toolCalls: [],
      activeRun: {
        runId: "run_sandbox",
        agentId: "agent_sandbox",
        projectId: "proj_sandbox",
        conversationId: "conv_sandbox",
        status: "running",
        startedAt: ts,
        turns: [
          {
            turnId: "turn_sandbox",
            ordinal: 0,
            messages: [
              {
                liveMessageId: "msg_sandbox",
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
  });

  it("keeps terminal recovered tool calls visible after activeRun clears", () => {
    const state: ConversationRenderState = {
      conversationId: "conv_sandbox",
      entries: [
        {
          id: "entry_user",
          conversationId: "conv_sandbox",
          agentId: "agent_sandbox",
          runId: "run_sandbox",
          role: "user",
          kind: "message",
          text: "Run the tool",
          createdAt: ts,
        },
      ],
      activeEntryIds: ["entry_user"],
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
