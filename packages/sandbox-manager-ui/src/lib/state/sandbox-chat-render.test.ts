import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ToolCallTranscriptRecord } from "@nervekit/shared";
import type { ConversationRenderState } from "@nervekit/shared-ui/state";
import { buildSandboxChatRender } from "./sandbox-chat-render";

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

describe("sandbox chat render", () => {
  it("keeps active-run tool calls in live content-index order", () => {
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

    const render = buildSandboxChatRender(state);

    assert.deepEqual(
      render.timeline.map((item) => item.key),
      [
        "entry_user",
        "live:msg_sandbox:text:0",
        "tool_bash",
        "live:msg_sandbox:text:2",
      ],
    );
  });

  it("keeps terminal recovered tool calls visible after a run completes", () => {
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

    const render = buildSandboxChatRender(state);

    assert.deepEqual(
      render.timeline.map((item) => item.key),
      ["entry_user", "tool_bash"],
    );
  });
});
