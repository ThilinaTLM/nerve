import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ConversationActiveRunSnapshot } from "@nervekit/contracts";
import {
  activeRunToLegacyLive,
  drainMaterializedLiveMessages,
  liveTextFromLegacyLive,
  materializedLiveMessagesFromEntries,
} from "./live";
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
      {
        materialized: {
          liveMessageIds: new Set(["msg_01HOLDER00000000000000000"]),
          turnWatermarks: new Map(),
        },
      },
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

  it("excludes messages at or below the per-turn ordinal watermark", () => {
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
                    text: "Materialized thought",
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
                    contentBlockId: "block_01H000000000000000000001",
                    contentIndex: 0,
                    text: "Current thought",
                    done: false,
                  },
                ],
              },
            ],
          },
        ],
      }),
      {
        // The materialized entry's liveMessageId did not correlate; only the
        // structural (turnId, messageOrdinal) watermark identifies it.
        materialized: {
          liveMessageIds: new Set(),
          turnWatermarks: new Map([["turn_01H0000000000000000000000", 0]]),
        },
      },
    );

    assert.deepEqual(
      live.messages.map((message) => message.id),
      ["live:msg_01HNEWER0000000000000000:thinking:0"],
    );
    assert.equal(live.messages[0]?.turnId, "turn_01H0000000000000000000000");
    assert.equal(live.messages[0]?.messageOrdinal, 1);
    assert.equal(
      live.messageMeta?.msg_01HNEWER0000000000000000?.messageOrdinal,
      1,
    );
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

describe("materializedLiveMessagesFromEntries", () => {
  it("collects assistant ids and per-turn ordinal watermarks", () => {
    const materialized = materializedLiveMessagesFromEntries([
      {
        role: "assistant",
        turnId: "turn_1",
        liveMessageId: "msg_1",
        messageOrdinal: 0,
      },
      {
        role: "assistant",
        turnId: "turn_1",
        liveMessageId: "msg_2",
        messageOrdinal: 2,
      },
      { role: "assistant", turnId: "turn_2", messageOrdinal: 1 },
      // Non-assistant and coordinate-free entries are ignored.
      { role: "user", turnId: "turn_1", messageOrdinal: 9 },
      { role: "assistant" },
    ]);

    assert.deepEqual([...materialized.liveMessageIds].sort(), [
      "msg_1",
      "msg_2",
    ]);
    assert.deepEqual(
      [...materialized.turnWatermarks.entries()],
      [
        ["turn_1", 2],
        ["turn_2", 1],
      ],
    );
  });
});

describe("drainMaterializedLiveMessages", () => {
  function liveState(): ConversationLiveState {
    return {
      runId: "run_1",
      messages: [
        {
          id: "live:msg_1:thinking:0",
          role: "assistant",
          displayKind: "thinking",
          text: "stale thought",
          contentIndex: 0,
          turnId: "turn_1",
          messageOrdinal: 0,
        },
        {
          id: "live:msg_2:thinking:0",
          role: "assistant",
          displayKind: "thinking",
          text: "current thought",
          contentIndex: 0,
          turnId: "turn_1",
          messageOrdinal: 1,
        },
      ],
      toolDrafts: [],
      toolOutputByToolCallId: {},
      messageMeta: {
        msg_1: { turnId: "turn_1", messageOrdinal: 0 },
        msg_2: { turnId: "turn_1", messageOrdinal: 1 },
      },
    };
  }

  it("drains by exact liveMessageId", () => {
    const live = liveState();
    drainMaterializedLiveMessages(live, {
      role: "assistant",
      liveMessageId: "msg_1",
    });
    assert.deepEqual(
      live.messages.map((message) => message.id),
      ["live:msg_2:thinking:0"],
    );
  });

  it("drains thinking by ordinal watermark when the id misses", () => {
    const live = liveState();
    drainMaterializedLiveMessages(live, {
      role: "assistant",
      turnId: "turn_1",
      messageOrdinal: 0,
    });
    assert.deepEqual(
      live.messages.map((message) => message.id),
      ["live:msg_2:thinking:0"],
    );
  });

  it("resolves coordinates from messageMeta when items lack them", () => {
    const live = liveState();
    live.messages = live.messages.map((message) => ({
      ...message,
      turnId: undefined,
      messageOrdinal: undefined,
    }));
    drainMaterializedLiveMessages(live, {
      role: "assistant",
      turnId: "turn_1",
      messageOrdinal: 0,
    });
    assert.deepEqual(
      live.messages.map((message) => message.id),
      ["live:msg_2:thinking:0"],
    );
  });

  it("ignores non-assistant entries and entries without coordinates", () => {
    const live = liveState();
    drainMaterializedLiveMessages(live, { role: "system" });
    drainMaterializedLiveMessages(live, { role: "assistant" });
    assert.equal(live.messages.length, 2);
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
