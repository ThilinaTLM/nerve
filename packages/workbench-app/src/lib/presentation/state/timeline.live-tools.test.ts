import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildConversationTimeline } from "./timeline";
import {
  activeRun,
  draftBlock,
  keys,
  liveMessage,
  runTurn,
  textBlock,
  toolCall,
} from "./timeline.fixtures";
import type { TranscriptItem } from "./transcript-types";

describe("buildConversationTimeline live tools", () => {
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
      activeRun({ runId: "run_active" }),
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
      activeRun({ runId: "run_active" }),
    );

    assert.deepEqual(keys(timeline), ["entry_user", "tool:tool_active"]);
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
        { status: "completed", runId: "run_active" },
      ),
    ];

    const timeline = buildConversationTimeline(
      transcript,
      toolCalls,
      activeRun({
        runId: "run_active",
        turns: [
          runTurn("turn_1", 0, [
            liveMessage("msg_active", 0, [
              textBlock("text", 0, "Running selected tools"),
            ]),
          ]),
        ],
        toolOutputsByToolCallId: {
          tool_with_live_output: {
            toolCallId: "tool_with_live_output",
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
      "tool-slot:msg_active:1",
      "tool:tool_with_live_output",
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
      activeRun({
        runId: "run_active",
        turns: [
          runTurn("turn_1", 0, [
            liveMessage("msg_active", 0, [
              textBlock("thinking", 0, "I should check the task state.", true),
              draftBlock(2, {
                providerToolCallId: "provider_start",
                toolName: "task_start",
              }),
            ]),
          ]),
        ],
      }),
    );

    assert.deepEqual(keys(timeline), [
      "entry_user",
      "live:msg_active:thinking:0",
      "tool-slot:msg_active:1",
      "tool-slot:msg_active:2",
    ]);
  });

  it("joins by exact coordinates before provider aliases", () => {
    const coordinateMatch = toolCall(
      "tool_by_slot",
      "2026-01-01T00:00:01.000Z",
      "bash",
      undefined,
      {
        runId: "run_01H00000000000000000000000",
        liveMessageId: "msg_1",
        contentIndex: 0,
        status: "running",
      },
    );
    const aliasMatch = toolCall(
      "tool_by_alias",
      "2026-01-01T00:00:02.000Z",
      "bash",
      "provider_call_1",
      {
        runId: "run_01H00000000000000000000000",
        status: "running",
      },
    );
    const timeline = buildConversationTimeline(
      [{ id: "entry_user", role: "user", text: "Run command" }],
      [coordinateMatch, aliasMatch],
      activeRun({
        turns: [
          runTurn("turn_1", 0, [
            liveMessage("msg_1", 0, [
              draftBlock(0, {
                providerToolCallId: "provider_call_1",
                toolName: "bash",
                done: true,
              }),
            ]),
          ]),
        ],
      }),
    );

    const joinedTools = timeline.filter((item) => item.kind === "tool");
    assert.equal(joinedTools.length, 1);
    const joined = joinedTools[0];
    assert.equal(joined?.kind, "tool");
    if (joined?.kind === "tool") {
      assert.equal(joined.key, "tool-slot:msg_1:0");
      assert.equal(joined.toolCall?.id, "tool_by_slot");
    }
  });

  it("keeps one stable key across draft-only, joined, and committed projections", () => {
    const run = (
      overrides: Parameters<typeof activeRun>[0] = {},
      draftOverrides: Parameters<typeof draftBlock>[1] = {},
    ) =>
      activeRun({
        runId: "run_active",
        turns: [
          runTurn("turn_1", 0, [
            liveMessage("msg_1", 0, [
              draftBlock(0, {
                providerToolCallId: "provider_call_1",
                toolName: "bash",
                ...draftOverrides,
              }),
            ]),
          ]),
        ],
        ...overrides,
      });
    const transcript: TranscriptItem[] = [
      { id: "entry_user", role: "user", text: "Run command" },
    ];

    // Phase 1: draft only.
    const draftOnly = buildConversationTimeline(transcript, [], run());
    // Phase 2: joined draft + running tool record.
    const record = toolCall(
      "tool_real",
      "2026-01-01T00:00:01.000Z",
      "bash",
      undefined,
      {
        runId: "run_active",
        providerToolCallId: "provider_call_1",
        liveMessageId: "msg_1",
        contentIndex: 0,
        status: "running",
      },
    );
    const joined = buildConversationTimeline(
      transcript,
      [record],
      run({}, { done: true }),
    );
    // Phase 3: committed (message materialized, entry anchors the tool).
    const committed = buildConversationTimeline(
      [
        ...transcript,
        {
          id: "entry_result",
          role: "system",
          text: "[Tool result: bash]",
          toolRecordId: "tool_real",
        },
      ],
      [{ ...record, status: "completed" }],
    );

    const expectedKey = "tool-slot:msg_1:0";
    assert.deepEqual(keys(draftOnly), ["entry_user", expectedKey]);
    assert.deepEqual(keys(joined), ["entry_user", expectedKey]);
    assert.deepEqual(keys(committed), ["entry_user", expectedKey]);
  });

  it("does not duplicate a card while the entry materializes around the tool", () => {
    const record = toolCall(
      "tool_real",
      "2026-01-01T00:00:01.000Z",
      "bash",
      undefined,
      {
        runId: "run_active",
        providerToolCallId: "provider_call_1",
        liveMessageId: "msg_1",
        contentIndex: 0,
        status: "running",
      },
    );
    // Entry appended and anchored, but the live message has not drained yet.
    const timeline = buildConversationTimeline(
      [
        { id: "entry_user", role: "user", text: "Run command" },
        {
          id: "entry_assistant",
          role: "assistant",
          text: "[Tool call: bash]",
          toolRecordId: "tool_real",
        },
      ],
      [record],
      activeRun({
        runId: "run_active",
        turns: [
          runTurn("turn_1", 0, [
            liveMessage("msg_1", 0, [
              draftBlock(0, {
                providerToolCallId: "provider_call_1",
                toolName: "bash",
                done: true,
              }),
            ]),
          ]),
        ],
      }),
    );

    assert.deepEqual(timeline.filter((item) => item.kind === "tool").length, 1);
  });

  it("overlays live output onto an already materialized tool card", () => {
    const record = toolCall(
      "tool_materialized",
      "2026-01-01T00:00:01.000Z",
      "bash",
      "provider_call_1",
      {
        runId: "run_active",
        liveMessageId: "msg_materialized",
        contentIndex: 1,
        status: "running",
      },
    );
    const timeline = buildConversationTimeline(
      [
        { id: "entry_user", role: "user", text: "Run command" },
        {
          id: "entry_assistant",
          role: "assistant",
          text: "[Tool call: bash]",
          liveMessageId: "msg_materialized",
        },
      ],
      [record],
      activeRun({
        runId: "run_active",
        toolOutputsByToolCallId: {
          tool_materialized: {
            toolCallId: "tool_materialized",
            chunks: [
              {
                stream: "stdout",
                text: "tick 1\n",
                ts: "2026-01-01T00:00:02.000Z",
              },
            ],
            text: "tick 1\n",
            updatedAt: "2026-01-01T00:00:02.000Z",
          },
        },
      }),
    );

    const tools = timeline.filter((item) => item.kind === "tool");
    assert.equal(tools.length, 1);
    assert.equal(tools[0]?.liveOutput?.text, "tick 1\n");
  });

  it("does not render orphaned live-status tools without an active owner", () => {
    const timeline = buildConversationTimeline(
      [{ id: "entry_final", role: "assistant", text: "All done." }],
      [
        toolCall(
          "tool_orphaned",
          "2026-01-01T00:00:01.000Z",
          "bash",
          undefined,
          { status: "running", runId: "run_failed" },
        ),
      ],
    );

    assert.deepEqual(keys(timeline), ["entry_final"]);
  });

  it("attaches live output to the matching tool card", () => {
    const running = toolCall(
      "tool_bash",
      "2026-01-01T00:00:01.000Z",
      "bash",
      undefined,
      {
        status: "running",
        runId: "run_01H00000000000000000000000",
      },
    );
    const timeline = buildConversationTimeline(
      [{ id: "entry_user", role: "user", text: "Run command" }],
      [running],
      activeRun({
        toolOutputsByToolCallId: {
          tool_bash: {
            toolCallId: "tool_bash",
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
