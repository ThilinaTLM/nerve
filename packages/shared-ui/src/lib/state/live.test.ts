import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ConversationActiveRunSnapshot } from "@nervekit/shared";
import { activeRunToLegacyLive, liveTextFromLegacyLive } from "./live";
import type { ConversationLiveState } from "./transcript-types";

function activeRun(
  overrides: Partial<ConversationActiveRunSnapshot> = {},
): ConversationActiveRunSnapshot {
  return {
    runId: "run_01H00000000000000000000000",
    agentId: "agent_01H00000000000000000000000",
    projectId: "proj_01H0000000000000000000000",
    conversationId: "conv_01H00000000000000000000000",
    status: "running",
    startedAt: "2026-01-01T00:00:00.000Z",
    turns: [],
    toolOutputsByToolCallId: {},
    queuedPrompts: [],
    ...overrides,
  };
}

describe("activeRunToLegacyLive", () => {
  it("excludes active-run messages that already have persisted entries", () => {
    const live = activeRunToLegacyLive(
      activeRun({
        turns: [
          {
            turnId: "turn_01H0000000000000000000000",
            ordinal: 0,
            messages: [
              {
                liveMessageId: "msg_01HOLDER00000000000000000",
                messageOrdinal: 0,
                startedAt: "2026-01-01T00:00:01.000Z",
                blocks: [
                  {
                    kind: "thinking",
                    contentBlockId: "block_01H000000000000000000000",
                    contentIndex: 0,
                    text: "Persisted thought",
                    done: true,
                  },
                  {
                    kind: "text",
                    contentBlockId: "block_01H000000000000000000001",
                    contentIndex: 1,
                    text: "Persisted answer",
                    done: true,
                  },
                  {
                    kind: "tool_call_draft",
                    contentBlockId: "block_01H000000000000000000002",
                    contentIndex: 2,
                    providerToolCallId: "call_persisted",
                    toolName: "read",
                    argsText: '{"path":"package.json"}',
                    done: true,
                  },
                ],
              },
              {
                liveMessageId: "msg_01HNEWER0000000000000000",
                messageOrdinal: 1,
                startedAt: "2026-01-01T00:00:02.000Z",
                blocks: [
                  {
                    kind: "thinking",
                    contentBlockId: "block_01H000000000000000000003",
                    contentIndex: 0,
                    text: "Current thought",
                    done: false,
                  },
                  {
                    kind: "text",
                    contentBlockId: "block_01H000000000000000000004",
                    contentIndex: 1,
                    text: "Current answer",
                    done: false,
                  },
                ],
              },
            ],
          },
        ],
      }),
      { excludeLiveMessageIds: ["msg_01HOLDER00000000000000000"] },
    );

    assert.deepEqual(
      live.messages.map((message) => message.id),
      [
        "live:msg_01HNEWER0000000000000000:thinking:0",
        "live:msg_01HNEWER0000000000000000:text:1",
      ],
    );
    assert.deepEqual(live.toolDrafts, []);
  });

  it("maps tool draft progress snapshots", () => {
    const live = activeRunToLegacyLive(
      activeRun({
        turns: [
          {
            turnId: "turn_01H0000000000000000000000",
            ordinal: 0,
            messages: [
              {
                liveMessageId: "msg_01HPROGRESS00000000000000",
                messageOrdinal: 0,
                startedAt: "2026-01-01T00:00:01.000Z",
                blocks: [
                  {
                    kind: "tool_call_draft",
                    contentBlockId: "block_01H000000000000000000005",
                    contentIndex: 0,
                    providerToolCallId: "call_live",
                    toolName: "edit",
                    argsText: "",
                    progress: {
                      path: "src/app.ts",
                      operationCount: 2,
                      generatedLineCount: 5,
                      estimatedAdditions: 5,
                      estimatedDeletions: 3,
                      estimated: true,
                    },
                    done: false,
                  },
                ],
              },
            ],
          },
        ],
      }),
    );

    assert.equal(live.toolDrafts[0]?.progress?.path, "src/app.ts");
    assert.equal(live.toolDrafts[0]?.progress?.operationCount, 2);
    assert.equal(live.toolDrafts[0]?.progress?.estimatedAdditions, 5);
  });

  it("maps active run retry snapshots to live run status", () => {
    const live = activeRunToLegacyLive(
      activeRun({
        status: "retrying",
        retry: {
          attempt: 2,
          maxRetries: 3,
          delayMs: 4000,
          retryAt: "2026-01-01T00:00:04.000Z",
          errorMessage: "timeout",
          failedEntryId: "entry_failed",
        },
      }),
    );

    assert.equal(live.runStatus?.state, "retrying");
    assert.equal(live.runStatus?.attempt, 2);
    assert.equal(live.runStatus?.failedEntryId, "entry_failed");
  });
});

describe("liveTextFromLegacyLive", () => {
  it("concatenates non-thinking live message text in content-index order", () => {
    const live: ConversationLiveState = {
      runId: "run_01H00000000000000000000000",
      messages: [
        {
          id: "live:msg_1:text:2",
          role: "assistant",
          displayKind: "message",
          text: "second",
          contentIndex: 2,
        },
        {
          id: "live:msg_1:thinking:0",
          role: "assistant",
          displayKind: "thinking",
          text: "hidden thought",
          contentIndex: 0,
        },
        {
          id: "live:msg_1:text:1",
          role: "assistant",
          displayKind: "message",
          text: "first",
          contentIndex: 1,
        },
      ],
      toolDrafts: [],
      toolOutputByToolCallId: {},
    };

    assert.equal(liveTextFromLegacyLive(live), "first\nsecond");
  });
});
