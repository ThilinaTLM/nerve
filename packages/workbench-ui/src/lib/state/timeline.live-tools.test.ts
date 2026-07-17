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
      "tool:tool_early",
      "tool:tool_late",
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
      "tool:tool_live",
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
      activeRun({ runId: "run_active" }),
    );

    assert.deepEqual(keys(timeline), [
      "entry_user",
      "tool:tool_completed_during_run",
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
        { status: "completed", runId: "run_old" },
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
      "tool:tool_older_create",
      "tool:tool_newer_update",
    ]);
  });

  it("appends live assistant text as a normal message node", () => {
    const timeline = buildConversationTimeline(
      [{ id: "entry_user", role: "user", text: "Hello" }],
      [],
      activeRun({
        turns: [
          runTurn("turn_1", 0, [
            liveMessage("msg_1", 0, [textBlock("text", 0, "Hi there")]),
          ]),
        ],
      }),
    );

    assert.deepEqual(keys(timeline), ["entry_user", "live:msg_1:text:0"]);
    assert.equal(timeline[1]?.kind, "message");
  });

  it("appends live thinking as a normal thinking message node", () => {
    const timeline = buildConversationTimeline(
      [{ id: "entry_user", role: "user", text: "Think" }],
      [],
      activeRun({
        turns: [
          runTurn("turn_1", 0, [
            liveMessage("msg_1", 0, [
              textBlock("thinking", 0, "I should reason about this."),
            ]),
          ]),
        ],
      }),
    );

    assert.deepEqual(keys(timeline), ["entry_user", "live:msg_1:thinking:0"]);
    assert.equal(timeline[1]?.kind, "message");
    if (timeline[1]?.kind === "message") {
      assert.equal(timeline[1].item.displayKind, "thinking");
    }
  });

  it("hands every pending approval draft to its own durable tool card", () => {
    const runId = "run_01H00000000000000000000000";
    const liveMessageId = "msg_approval_batch";
    const providerIds = [
      "provider_approval_first",
      "provider_approval_second",
      "provider_approval_third",
    ];
    const toolCalls = providerIds.map((providerToolCallId, contentIndex) =>
      toolCall(
        `tool_approval_${contentIndex}`,
        `2026-01-01T00:00:0${contentIndex + 1}.000Z`,
        "bash",
        providerToolCallId,
        {
          providerToolCallId,
          runId,
          liveMessageId,
          contentIndex,
          risk: "command",
          status: "pending_approval",
        },
      ),
    );

    const timeline = buildConversationTimeline(
      [{ id: "entry_user", role: "user", text: "Run three commands" }],
      toolCalls,
      activeRun({
        runId,
        status: "running",
        turns: [
          runTurn("turn_1", 0, [
            liveMessage(
              liveMessageId,
              0,
              providerIds.map((providerToolCallId, contentIndex) =>
                draftBlock(contentIndex, {
                  providerToolCallId,
                  toolName: "bash",
                  argsText: `{"command":"printf ${contentIndex + 1}"}`,
                  done: true,
                }),
              ),
            ),
          ]),
        ],
      }),
    );

    const toolNodes = timeline.filter((item) => item.kind === "tool");
    assert.deepEqual(
      toolNodes.map((node) => node.key),
      [
        "tool-slot:msg_approval_batch:0",
        "tool-slot:msg_approval_batch:1",
        "tool-slot:msg_approval_batch:2",
      ],
    );
    assert.deepEqual(
      toolNodes.map((node) => node.toolCall?.id),
      ["tool_approval_0", "tool_approval_1", "tool_approval_2"],
    );
    assert.ok(
      toolNodes.every(
        (node) =>
          node.toolCall?.status === "pending_approval" &&
          node.draft !== undefined,
      ),
    );
  });

  it("joins a live draft with a fast completed record by provider alias", () => {
    const matching = toolCall(
      "tool_real",
      "2026-01-01T00:00:01.000Z",
      "bash",
      "provider_call_1",
      { status: "completed" },
    );
    const timeline = buildConversationTimeline(
      [{ id: "entry_user", role: "user", text: "Run command" }],
      [matching],
      activeRun({
        turns: [
          runTurn("turn_1", 0, [
            liveMessage("msg_1", 0, [
              draftBlock(0, {
                providerToolCallId: "provider_call_1",
                toolName: "bash",
                argsText: '{"command":"pwd"}',
                done: true,
              }),
            ]),
          ]),
        ],
      }),
    );

    assert.deepEqual(keys(timeline), ["entry_user", "tool-slot:msg_1:0"]);
    assert.equal(timeline[1]?.kind, "tool");
    if (timeline[1]?.kind === "tool") {
      assert.equal(timeline[1].toolCall?.id, "tool_real");
      assert.equal(timeline[1].draft?.block.toolName, "bash");
    }
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
          id: "entry_assistant",
          role: "assistant",
          text: "[Tool call: bash]",
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

  it("does not append a live alias after an approved call is committed", () => {
    const completed = toolCall(
      "tool_completed",
      "2026-01-01T00:00:01.000Z",
      "jira_search_issues",
      "provider_call_1",
      { runId: "run_active", status: "completed" },
    );
    const resumedAlias = toolCall(
      "tool_resumed_alias",
      "2026-01-01T00:00:02.000Z",
      "jira_search_issues",
      "provider_call_1",
      { runId: "run_active", status: "running" },
    );
    const timeline = buildConversationTimeline(
      [
        { id: "entry_user", role: "user", text: "Search Jira" },
        {
          id: "entry_tool_result",
          role: "system",
          text: "Jira search completed",
          toolRecordId: completed.id,
        },
      ],
      [completed, resumedAlias],
      activeRun({ runId: "run_active" }),
    );

    const tools = timeline.filter((item) => item.kind === "tool");
    assert.equal(tools.length, 1);
    assert.equal(tools[0]?.kind, "tool");
    if (tools[0]?.kind === "tool") {
      assert.equal(tools[0].toolCall?.id, "tool_completed");
      assert.equal(tools[0].toolCall?.status, "completed");
    }
  });

  it("produces identical keys for repeated projections of the same state", () => {
    const state = activeRun({
      runId: "run_active",
      turns: [
        runTurn("turn_1", 0, [
          liveMessage("msg_1", 0, [
            textBlock("thinking", 0, "Reasoning", true),
            draftBlock(1, { toolName: "bash" }),
            textBlock("text", 2, "Progress update"),
          ]),
        ]),
      ],
    });
    const transcript: TranscriptItem[] = [
      { id: "entry_user", role: "user", text: "Go" },
    ];

    assert.deepEqual(
      keys(buildConversationTimeline(transcript, [], state)),
      keys(buildConversationTimeline(transcript, [], state)),
    );
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
