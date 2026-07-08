import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildCommittedTimeline, buildConversationTimeline } from "./timeline";
import { keys, toolCall } from "./timeline.fixtures";
import type { TranscriptItem } from "./transcript-types";

describe("buildConversationTimeline committed transcript", () => {
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

  it("renders completed unanchored historical tool calls by timestamp", () => {
    const transcript: TranscriptItem[] = [
      {
        id: "entry_user",
        role: "user",
        text: "List files",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "entry_assistant",
        role: "assistant",
        text: "Done.",
        createdAt: "2026-01-01T00:00:03.000Z",
      },
    ];
    const toolCalls = [toolCall("tool_01", "2026-01-01T00:00:01.000Z", "ls")];

    const timeline = buildConversationTimeline(transcript, toolCalls);

    assert.deepEqual(keys(timeline), [
      "entry_user",
      "tool_01",
      "entry_assistant",
    ]);
    assert.equal(timeline[1]?.kind, "tool");
  });

  it("does not commit-render running unanchored tool calls", () => {
    const transcript: TranscriptItem[] = [
      {
        id: "entry_user",
        role: "user",
        text: "List files",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ];
    const toolCalls = [
      toolCall("tool_01", "2026-01-01T00:00:01.000Z", "ls", undefined, {
        status: "running",
      }),
    ];

    const committed = buildCommittedTimeline(transcript, toolCalls);

    assert.deepEqual(keys(committed.items), ["entry_user"]);
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
});
