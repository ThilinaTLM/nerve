import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ToolCallRecord } from "../../api";
import type { TranscriptItem } from "./state.svelte";
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
    sessionId: "ses_01H00000000000000000000000",
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

  it("keeps completed assistant thinking blocks attached to message items", () => {
    const transcript: TranscriptItem[] = [
      { id: "entry_user", role: "user", text: "Think about it" },
      {
        id: "entry_assistant",
        role: "assistant",
        text: "Done.",
        thinkingBlocks: [{ text: "I should inspect the request first." }],
      },
    ];

    const timeline = buildConversationTimeline(transcript, []);

    assert.deepEqual(keys(timeline), ["entry_user", "entry_assistant"]);
    assert.equal(timeline[1]?.kind, "message");
    if (timeline[1]?.kind === "message") {
      assert.deepEqual(timeline[1].item.thinkingBlocks, [
        { text: "I should inspect the request first." },
      ]);
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
  });

  it("keeps tool placeholders when they carry thinking blocks", () => {
    const transcript: TranscriptItem[] = [
      { id: "entry_user", role: "user", text: "List files" },
      {
        id: "entry_placeholder",
        role: "assistant",
        text: "[Tool call: ls({})]",
        thinkingBlocks: [{ text: "I need to inspect the directory." }],
      },
    ];

    const timeline = buildConversationTimeline(transcript, []);

    assert.deepEqual(keys(timeline), ["entry_user", "entry_placeholder"]);
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
});
