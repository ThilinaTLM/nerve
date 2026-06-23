import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { TranscriptItem } from "$lib/core/types/state-types";
import { buildConversationTimeline } from "./timeline";
import { keys, liveState, toolCall } from "./timeline.fixtures";

describe("buildConversationTimeline live tools", () => {
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

  it("keeps completed unanchored tool calls visible for the active run", () => {
    const transcript: TranscriptItem[] = [
      { id: "entry_user", role: "user", text: "Run tools" },
    ];
    const toolCalls = [
      toolCall(
        "tool_completed_during_run",
        "2026-01-01T00:00:01.000Z",
        "bash",
        undefined,
        { runId: "run_active", status: "completed" },
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

  it("does not resurrect unrelated completed tool calls during another active run", () => {
    const transcript: TranscriptItem[] = [
      { id: "entry_user", role: "user", text: "Run tools" },
    ];
    const toolCalls = [
      toolCall(
        "tool_completed_old_run",
        "2026-01-01T00:00:01.000Z",
        "bash",
        undefined,
        { runId: "run_old", status: "completed" },
      ),
    ];

    const timeline = buildConversationTimeline(
      transcript,
      toolCalls,
      liveState({ runId: "run_active" }),
    );

    assert.deepEqual(keys(timeline), ["entry_user"]);
  });

  it("does not pin a stale running tool call from a finished run during an active run", () => {
    const transcript: TranscriptItem[] = [
      { id: "entry_user", role: "user", text: "Run tools" },
    ];
    const toolCalls = [
      toolCall("tool_stale", "2026-01-01T00:00:01.000Z", "bash", undefined, {
        runId: "run_old",
        status: "running",
      }),
      toolCall("tool_active", "2026-01-01T00:00:02.000Z", "bash", undefined, {
        runId: "run_active",
        status: "running",
      }),
    ];

    const timeline = buildConversationTimeline(
      transcript,
      toolCalls,
      liveState({ runId: "run_active" }),
    );

    assert.deepEqual(keys(timeline), ["entry_user", "tool_active"]);
  });

  it("keeps live candidates scoped to active-run and live-output tools", () => {
    const transcript: TranscriptItem[] = [
      { id: "entry_user", role: "user", text: "Run tools" },
    ];
    const unrelatedCompleted = Array.from({ length: 20 }, (_, index) =>
      toolCall(
        `tool_completed_${index}`,
        `2026-01-01T00:00:${String(index).padStart(2, "0")}.000Z`,
        "read",
        undefined,
        { status: "completed", runId: "run_old" },
      ),
    );
    const toolCalls = [
      ...unrelatedCompleted,
      toolCall(
        "tool_active_placed",
        "2026-01-01T00:01:00.000Z",
        "bash",
        undefined,
        {
          runId: "run_active",
          liveMessageId: "msg_active",
          contentIndex: 1,
          status: "completed",
        },
      ),
      toolCall(
        "tool_with_live_output",
        "2026-01-01T00:01:01.000Z",
        "bash",
        undefined,
        { status: "completed", runId: "run_old" },
      ),
    ];

    const timeline = buildConversationTimeline(
      transcript,
      toolCalls,
      liveState({
        runId: "run_active",
        messages: [
          {
            id: "live:msg_active:text:0",
            role: "assistant",
            displayKind: "message",
            text: "Running selected tools",
            contentIndex: 0,
            live: true,
          },
        ],
        toolOutputByToolCallId: {
          tool_with_live_output: {
            chunks: [
              {
                stream: "stdout",
                text: "still flushing\n",
                ts: "2026-01-01T00:01:02.000Z",
              },
            ],
            text: "still flushing\n",
            updatedAt: "2026-01-01T00:01:02.000Z",
          },
        },
      }),
    );

    assert.deepEqual(keys(timeline), [
      "entry_user",
      "live:msg_active:text:0",
      "tool_active_placed",
      "tool_with_live_output",
    ]);
  });

  it("orders active-run tool calls by live content index after draft removal", () => {
    const transcript: TranscriptItem[] = [
      { id: "entry_user", role: "user", text: "Run tools" },
    ];
    const toolCalls = [
      toolCall(
        "tool_task_status",
        "2026-01-01T00:00:02.000Z",
        "task_status",
        "provider_status",
        {
          runId: "run_active",
          liveMessageId: "msg_active",
          contentIndex: 1,
          status: "completed",
        },
      ),
    ];

    const timeline = buildConversationTimeline(
      transcript,
      toolCalls,
      liveState({
        runId: "run_active",
        messages: [
          {
            id: "live:msg_active:thinking:0",
            role: "assistant",
            displayKind: "thinking",
            text: "I should check the task state.",
            createdAt: "2026-01-01T00:00:00.000Z",
            contentIndex: 0,
            live: false,
            done: true,
          },
        ],
        toolDrafts: [
          {
            kind: "tool_call_draft",
            key: "live:msg_active:tool-draft:2",
            runId: "run_active",
            conversationId: "conv_01H00000000000000000000000",
            contentIndex: 2,
            providerToolCallId: "provider_start",
            toolName: "task_start",
            argsText: "",
            done: false,
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:03.000Z",
          },
        ],
      }),
    );

    assert.deepEqual(keys(timeline), [
      "entry_user",
      "live:msg_active:thinking:0",
      "tool_task_status",
      "live:msg_active:tool-draft:2",
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

  it("matches live tool drafts by provider tool-call id", () => {
    const matching = toolCall(
      "tool_real",
      "2026-01-01T00:00:01.000Z",
      "bash",
      undefined,
      { providerToolCallId: "provider_call_1", status: "running" },
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
});
