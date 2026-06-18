import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ToolCallRecord } from "$lib/api";
import type {
  ConversationLiveState,
  TranscriptItem,
} from "$lib/features/state-types";
import { buildConversationTimeline } from "./timeline";

function toolCall(
  id: string,
  createdAt: string,
  toolName: ToolCallRecord["toolName"] = "read",
  sourceToolCallId?: string,
  overrides: Partial<ToolCallRecord> = {},
): ToolCallRecord {
  return {
    id,
    agentId: "agent_01H00000000000000000000000",
    conversationId: "conv_01H00000000000000000000000",
    projectId: "proj_01H0000000000000000000000",
    toolName,
    sourceToolCallId,
    risk: "read",
    args: {},
    cwd: "/tmp/project",
    status: "completed",
    createdAt,
    updatedAt: createdAt,
    ...overrides,
  };
}

function keys(items: ReturnType<typeof buildConversationTimeline>): string[] {
  return items.map((item) => item.key);
}

function liveState(
  overrides: Partial<ConversationLiveState> = {},
): ConversationLiveState {
  return {
    runId: "run_01H00000000000000000000000",
    messages: [],
    toolDrafts: [],
    toolOutputByToolCallId: {},
    ...overrides,
  };
}

describe("buildConversationTimeline", () => {
  it("keeps optimistic user messages before live tool calls", () => {
    const transcript: TranscriptItem[] = [
      { role: "user", text: "Investigate this", optimistic: true },
    ];
    const toolCalls = [
      toolCall("tool_02", "2026-01-01T00:00:02.000Z", "read", undefined, {
        status: "running",
      }),
    ];

    const timeline = buildConversationTimeline(transcript, toolCalls);

    assert.deepEqual(keys(timeline), ["msg-0", "tool_02"]);
    assert.equal(timeline[0]?.kind, "message");
    assert.equal(timeline[1]?.kind, "tool");
  });

  it("keeps completed assistant thinking as separate message items", () => {
    const transcript: TranscriptItem[] = [
      { id: "entry_user", role: "user", text: "Think about it" },
      {
        id: "entry_assistant:thinking:0",
        role: "assistant",
        displayKind: "thinking",
        text: "I should inspect the request first.",
      },
      {
        id: "entry_assistant",
        role: "assistant",
        displayKind: "message",
        text: "Done.",
      },
    ];

    const timeline = buildConversationTimeline(transcript, []);

    assert.deepEqual(keys(timeline), [
      "entry_user",
      "entry_assistant:thinking:0",
      "entry_assistant",
    ]);
    assert.equal(timeline[1]?.kind, "message");
    if (timeline[1]?.kind === "message") {
      assert.equal(timeline[1].item.displayKind, "thinking");
    }
  });

  it("anchors historical tool cards at matching tool-result entries", () => {
    const transcript: TranscriptItem[] = [
      {
        id: "entry_user",
        role: "user",
        text: "Read package.json",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "entry_result",
        role: "system",
        text: "{ name: 'nerve' }",
        toolCallId: "provider_call_1",
        toolRecordId: "tool_01",
        createdAt: "2026-01-01T00:00:02.000Z",
      },
      {
        id: "entry_assistant",
        role: "assistant",
        text: "It is named nerve.",
        createdAt: "2026-01-01T00:00:03.000Z",
      },
    ];
    const toolCalls = [toolCall("tool_01", "2026-01-01T00:00:01.000Z")];

    const timeline = buildConversationTimeline(transcript, toolCalls);

    assert.deepEqual(keys(timeline), [
      "entry_user",
      "tool_01",
      "entry_assistant",
    ]);
    assert.deepEqual(
      timeline.map((item) => item.kind),
      ["message", "tool", "message"],
    );
    assert.equal(timeline[1]?.kind, "tool");
    if (timeline[1]?.kind === "tool") {
      assert.equal(timeline[1].anchorEntryId, "entry_result");
    }
  });

  it("anchors errored validation tool cards at matching tool-result entries", () => {
    const transcript: TranscriptItem[] = [
      { id: "entry_user", role: "user", text: "Edit file" },
      {
        id: "entry_result",
        role: "system",
        text: "Validation failed for tool edit.",
        toolCallId: "provider_call_1",
        toolName: "edit",
        isToolError: true,
      },
    ];
    const toolCalls = [
      toolCall(
        "tool_error",
        "2026-01-01T00:00:01.000Z",
        "edit",
        "provider_call_1",
        {
          status: "error",
          error: "Validation failed for tool edit.",
        },
      ),
    ];

    const timeline = buildConversationTimeline(transcript, toolCalls);

    assert.deepEqual(keys(timeline), ["entry_user", "tool_error"]);
    assert.equal(timeline[1]?.kind, "tool");
    if (timeline[1]?.kind === "tool") {
      assert.equal(timeline[1].anchorEntryId, "entry_result");
    }
  });

  it("renders unmatched historical tool-result errors as fallback error cards", () => {
    const transcript: TranscriptItem[] = [
      { id: "entry_user", role: "user", text: "Edit file" },
      {
        id: "entry_result",
        role: "system",
        text: "Validation failed for tool edit.",
        toolCallId: "provider_call_1",
        toolName: "edit",
        isToolError: true,
      },
    ];

    const timeline = buildConversationTimeline(transcript, []);

    assert.deepEqual(keys(timeline), ["entry_user", "entry_result"]);
    assert.equal(timeline[1]?.kind, "tool_result_error");
    if (timeline[1]?.kind === "tool_result_error") {
      assert.equal(timeline[1].toolName, "edit");
      assert.equal(timeline[1].error, "Validation failed for tool edit.");
    }
  });

  it("keeps accepted plan tool cards before the follow-up implementation instruction", () => {
    const transcript: TranscriptItem[] = [
      { id: "entry_user", role: "user", text: "Create a plan" },
      {
        id: "entry_plan_placeholder",
        role: "assistant",
        text: "[Tool call: plan_mode_present({})]",
      },
      {
        id: "entry_plan_result",
        role: "system",
        text: "Plan accepted. Proceed with implementation.",
        toolCallId: "call_plan",
        toolRecordId: "tool_plan",
      },
      {
        id: "entry_plan_followup",
        role: "user",
        text: "The user accepted the plan. Proceed with implementation.",
      },
      {
        id: "entry_next_assistant",
        role: "assistant",
        text: "I will start coding.",
      },
    ];
    const toolCalls = [
      toolCall(
        "tool_plan",
        "2026-01-01T00:00:01.000Z",
        "plan_mode_present",
        "call_plan",
        { risk: "interaction" },
      ),
    ];

    const timeline = buildConversationTimeline(transcript, toolCalls);

    assert.deepEqual(keys(timeline), [
      "entry_user",
      "tool_plan",
      "entry_plan_followup",
      "entry_next_assistant",
    ]);
  });

  it("keeps thinking entries while hiding adjacent tool placeholders", () => {
    const transcript: TranscriptItem[] = [
      { id: "entry_user", role: "user", text: "List files" },
      {
        id: "entry_placeholder:thinking:0",
        role: "assistant",
        displayKind: "thinking",
        text: "I need to inspect the directory.",
      },
      {
        id: "entry_placeholder",
        role: "assistant",
        text: "[Tool call: ls({})]",
      },
    ];

    const timeline = buildConversationTimeline(transcript, []);

    assert.deepEqual(keys(timeline), [
      "entry_user",
      "entry_placeholder:thinking:0",
    ]);
  });

  it("hides tool-only assistant placeholders", () => {
    const transcript: TranscriptItem[] = [
      { id: "entry_user", role: "user", text: "List files" },
      {
        id: "entry_placeholder",
        role: "assistant",
        text: "[Tool call: ls({})]",
      },
    ];
    const toolCalls = [
      toolCall("tool_01", "2026-01-01T00:00:01.000Z", "ls", undefined, {
        status: "running",
      }),
    ];

    const timeline = buildConversationTimeline(transcript, toolCalls);

    assert.deepEqual(keys(timeline), ["entry_user", "tool_01"]);
  });

  it("anchors tool cards by source tool-call id when no internal id exists", () => {
    const transcript: TranscriptItem[] = [
      { id: "entry_user", role: "user", text: "Use a failing tool" },
      {
        id: "entry_error_result",
        role: "system",
        text: "Tool failed",
        toolCallId: "provider_call_1",
      },
      { id: "entry_assistant", role: "assistant", text: "It failed." },
    ];
    const toolCalls = [
      toolCall(
        "tool_error",
        "2026-01-01T00:00:01.000Z",
        "read",
        "provider_call_1",
      ),
    ];

    const timeline = buildConversationTimeline(transcript, toolCalls);

    assert.deepEqual(keys(timeline), [
      "entry_user",
      "tool_error",
      "entry_assistant",
    ]);
    assert.equal(timeline[1]?.kind, "tool");
    if (timeline[1]?.kind === "tool") {
      assert.equal(timeline[1].anchorEntryId, "entry_error_result");
    }
  });

  it("preserves anchored branch order for multiple tool calls", () => {
    const transcript: TranscriptItem[] = [
      { id: "entry_user", role: "user", text: "Use tools" },
      {
        id: "entry_result_b",
        role: "system",
        text: "second in branch",
        toolRecordId: "tool_b",
      },
      {
        id: "entry_result_a",
        role: "system",
        text: "third in branch",
        toolRecordId: "tool_a",
      },
    ];
    const toolCalls = [
      toolCall("tool_a", "2026-01-01T00:00:01.000Z"),
      toolCall("tool_b", "2026-01-01T00:00:02.000Z"),
    ];

    const timeline = buildConversationTimeline(transcript, toolCalls);

    assert.deepEqual(keys(timeline), ["entry_user", "tool_b", "tool_a"]);
  });

  it("appends unanchored live tool calls after transcript", () => {
    const transcript: TranscriptItem[] = [
      { id: "entry_user", role: "user", text: "Run tools" },
      { id: "entry_assistant", role: "assistant", text: "Working..." },
    ];
    const toolCalls = [
      toolCall("tool_late", "2026-01-01T00:00:03.000Z", "read", undefined, {
        status: "running",
      }),
      toolCall("tool_early", "2026-01-01T00:00:01.000Z", "read", undefined, {
        status: "requested",
      }),
    ];

    const timeline = buildConversationTimeline(transcript, toolCalls);

    assert.deepEqual(keys(timeline), [
      "entry_user",
      "entry_assistant",
      "tool_early",
      "tool_late",
    ]);
  });

  it("omits completed unanchored historical tool calls", () => {
    const transcript: TranscriptItem[] = [
      { id: "entry_user", role: "user", text: "Run tools" },
      { id: "entry_assistant", role: "assistant", text: "Done." },
    ];
    const toolCalls = [
      toolCall(
        "tool_historical",
        "2026-01-01T00:00:01.000Z",
        "read",
        undefined,
        {
          status: "completed",
        },
      ),
      toolCall("tool_live", "2026-01-01T00:00:02.000Z", "read", undefined, {
        status: "running",
      }),
    ];

    const timeline = buildConversationTimeline(transcript, toolCalls);

    assert.deepEqual(keys(timeline), [
      "entry_user",
      "entry_assistant",
      "tool_live",
    ]);
  });

  it("keeps completed unanchored tool calls visible during an active run", () => {
    const transcript: TranscriptItem[] = [
      { id: "entry_user", role: "user", text: "Run tools" },
    ];
    const toolCalls = [
      toolCall(
        "tool_completed_during_run",
        "2026-01-01T00:00:01.000Z",
        "bash",
        undefined,
        { status: "completed" },
      ),
    ];

    const timeline = buildConversationTimeline(
      transcript,
      toolCalls,
      liveState({ runId: "run_active" }),
    );

    assert.deepEqual(keys(timeline), [
      "entry_user",
      "tool_completed_during_run",
    ]);
  });

  it("ignores API updatedAt order for unanchored tool calls", () => {
    const transcript: TranscriptItem[] = [
      { id: "entry_user", role: "user", text: "Run tools" },
    ];
    const toolCalls = [
      toolCall(
        "tool_newer_update",
        "2026-01-01T00:00:02.000Z",
        "read",
        undefined,
        {
          status: "running",
          updatedAt: "2026-01-01T00:00:10.000Z",
        },
      ),
      toolCall(
        "tool_older_create",
        "2026-01-01T00:00:01.000Z",
        "read",
        undefined,
        {
          status: "requested",
          updatedAt: "2026-01-01T00:00:11.000Z",
        },
      ),
    ];

    const timeline = buildConversationTimeline(transcript, toolCalls);

    assert.deepEqual(keys(timeline), [
      "entry_user",
      "tool_older_create",
      "tool_newer_update",
    ]);
  });

  it("appends live assistant text as a normal message node", () => {
    const timeline = buildConversationTimeline(
      [{ id: "entry_user", role: "user", text: "Hello" }],
      [],
      liveState({
        messages: [
          {
            id: "live:run_1:text:0",
            role: "assistant",
            displayKind: "message",
            text: "Hi there",
            contentIndex: 0,
            live: true,
          },
        ],
      }),
    );

    assert.deepEqual(keys(timeline), ["entry_user", "live:run_1:text:0"]);
    assert.equal(timeline[1]?.kind, "message");
  });

  it("appends live thinking as a normal thinking message node", () => {
    const timeline = buildConversationTimeline(
      [{ id: "entry_user", role: "user", text: "Think" }],
      [],
      liveState({
        messages: [
          {
            id: "live:run_1:thinking:0",
            role: "assistant",
            displayKind: "thinking",
            text: "I should reason about this.",
            contentIndex: 0,
            live: true,
          },
        ],
      }),
    );

    assert.deepEqual(keys(timeline), ["entry_user", "live:run_1:thinking:0"]);
    assert.equal(timeline[1]?.kind, "message");
    if (timeline[1]?.kind === "message") {
      assert.equal(timeline[1].item.displayKind, "thinking");
    }
  });

  it("replaces a live tool draft with the matching real tool call", () => {
    const matching = toolCall(
      "tool_real",
      "2026-01-01T00:00:01.000Z",
      "bash",
      "provider_call_1",
      { status: "running" },
    );
    const timeline = buildConversationTimeline(
      [{ id: "entry_user", role: "user", text: "Run command" }],
      [matching],
      liveState({
        toolDrafts: [
          {
            kind: "tool_call_draft",
            key: "live:run_1:tool-draft:0",
            runId: "run_1",
            conversationId: "conv_01H00000000000000000000000",
            contentIndex: 0,
            providerToolCallId: "provider_call_1",
            toolName: "bash",
            argsText: '{"command":"pwd"}',
            done: true,
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
        ],
      }),
    );

    assert.deepEqual(keys(timeline), ["entry_user", "tool_real"]);
    assert.equal(timeline[1]?.kind, "tool");
  });

  it("attaches live output to the matching tool card", () => {
    const running = toolCall(
      "tool_bash",
      "2026-01-01T00:00:01.000Z",
      "bash",
      undefined,
      { status: "running" },
    );
    const timeline = buildConversationTimeline(
      [{ id: "entry_user", role: "user", text: "Run command" }],
      [running],
      liveState({
        toolOutputByToolCallId: {
          tool_bash: {
            chunks: [
              {
                stream: "stdout",
                text: "hello\n",
                ts: "2026-01-01T00:00:02.000Z",
              },
            ],
            text: "hello\n",
            updatedAt: "2026-01-01T00:00:02.000Z",
          },
        },
      }),
    );

    assert.equal(timeline[1]?.kind, "tool");
    if (timeline[1]?.kind === "tool") {
      assert.equal(timeline[1].liveOutput?.text, "hello\n");
    }
  });

  it("appends live retry status and suppresses the referenced failed assistant", () => {
    const timeline = buildConversationTimeline(
      [
        { id: "entry_user", role: "user", text: "Go" },
        { id: "entry_failed", role: "assistant", text: "Agent run failed" },
      ],
      [],
      liveState({
        runStatus: {
          state: "retrying",
          runId: "run_01H00000000000000000000000",
          failedEntryId: "entry_failed",
          attempt: 1,
          maxRetries: 3,
        },
      }),
    );

    assert.deepEqual(keys(timeline), [
      "entry_user",
      "run-status:run_01H00000000000000000000000",
    ]);
    assert.equal(timeline[1]?.kind, "run_status");
  });

  it("keeps retry-failed assistant hidden while the next attempt streams", () => {
    const timeline = buildConversationTimeline(
      [
        { id: "entry_user", role: "user", text: "Go" },
        { id: "entry_failed", role: "assistant", text: "Agent run failed" },
      ],
      [],
      liveState({
        hiddenEntryIds: ["entry_failed"],
        messages: [
          {
            id: "live:msg_1:text:0",
            role: "assistant",
            displayKind: "message",
            text: "Retry response",
            live: true,
          },
        ],
      }),
    );

    assert.deepEqual(keys(timeline), ["entry_user", "live:msg_1:text:0"]);
  });

  it("renders persisted compaction entries as compaction timeline nodes", () => {
    const timeline = buildConversationTimeline(
      [
        { id: "entry_user", role: "user", text: "Go" },
        {
          id: "entry_compaction",
          role: "system",
          text: "Summary",
          kind: "compaction",
          compaction: {
            id: "entry_compaction",
            entryId: "entry_compaction",
            state: "completed",
            reason: "manual",
            summary: "Summary",
          },
        },
      ],
      [],
    );

    assert.deepEqual(keys(timeline), ["entry_user", "entry_compaction"]);
    assert.equal(timeline[1]?.kind, "compaction");
  });

  it("appends live compaction and hides the failed overflow entry", () => {
    const timeline = buildConversationTimeline(
      [
        { id: "entry_user", role: "user", text: "Go" },
        { id: "entry_failed", role: "assistant", text: "Too many tokens" },
      ],
      [],
      liveState({
        compaction: {
          id: "live:compaction:run_1:overflow",
          state: "running",
          reason: "overflow",
          runId: "run_1",
          failedEntryId: "entry_failed",
        },
      }),
    );

    assert.deepEqual(keys(timeline), [
      "entry_user",
      "live:compaction:run_1:overflow",
    ]);
    assert.equal(timeline[1]?.kind, "compaction");
  });

  it("renders persisted run status entries as status timeline nodes", () => {
    const timeline = buildConversationTimeline(
      [
        { id: "entry_user", role: "user", text: "Go" },
        {
          id: "entry_status",
          role: "system",
          text: "Model request failed after 3 retries.",
          kind: "run_status",
          runStatus: {
            entryId: "entry_status",
            runId: "run_retry",
            state: "retry_exhausted",
            failedEntryId: "entry_failed",
            retryable: true,
          },
        },
      ],
      [],
    );

    assert.deepEqual(keys(timeline), ["entry_user", "run-status:run_retry"]);
    assert.equal(timeline[1]?.kind, "run_status");
  });

  it("keeps one status node when live and persisted retry state share a run", () => {
    const timeline = buildConversationTimeline(
      [
        { id: "entry_user", role: "user", text: "Go" },
        {
          id: "entry_status",
          role: "system",
          text: "Model request failed after 3 retries.",
          kind: "run_status",
          runStatus: {
            entryId: "entry_status",
            runId: "run_retry",
            state: "retry_exhausted",
            failedEntryId: "entry_failed",
            retryable: true,
          },
        },
      ],
      [],
      liveState({
        runId: "run_retry",
        runStatus: {
          runId: "run_retry",
          state: "retrying",
          attempt: 3,
          maxRetries: 3,
        },
      }),
    );

    assert.deepEqual(keys(timeline), ["entry_user", "run-status:run_retry"]);
    assert.equal(
      timeline.filter((item) => item.kind === "run_status").length,
      1,
    );
  });

  it("hides persisted failed assistant and thinking from exhausted retry runs", () => {
    const timeline = buildConversationTimeline(
      [
        { id: "entry_user", role: "user", text: "Go" },
        {
          id: "entry_failed_1:thinking:0",
          runId: "run_retry",
          role: "assistant",
          displayKind: "thinking",
          text: "Partial thinking from failed stream",
          stopReason: "error",
        },
        {
          id: "entry_failed_1",
          runId: "run_retry",
          role: "assistant",
          text: "Agent run failed",
          stopReason: "error",
        },
        {
          id: "entry_failed_3:thinking:0",
          runId: "run_retry",
          role: "assistant",
          displayKind: "thinking",
          text: "More partial thinking",
          stopReason: "error",
        },
        {
          id: "entry_failed_3",
          runId: "run_retry",
          role: "assistant",
          text: "Agent run failed",
          stopReason: "error",
        },
        {
          id: "entry_status",
          role: "system",
          text: "Model request failed after 3 retries.",
          kind: "run_status",
          runStatus: {
            entryId: "entry_status",
            runId: "run_retry",
            state: "retry_exhausted",
            failedEntryId: "entry_failed_3",
            retryable: true,
          },
        },
      ],
      [],
    );

    assert.deepEqual(keys(timeline), ["entry_user", "run-status:run_retry"]);
  });
});
