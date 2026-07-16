import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildActiveRunTimeline,
  buildCommittedTimeline,
  buildConversationTimeline,
  selectVisibleCommitted,
} from "./timeline";
import {
  activeRun,
  keys,
  liveMessage,
  runTurn,
  textBlock,
  toolCall,
} from "./timeline.fixtures";
import type { TranscriptItem } from "./transcript-types";

const RETRY = {
  attempt: 1,
  maxRetries: 3,
  delayMs: 1000,
  retryAt: "2026-01-01T00:00:05.000Z",
};

describe("buildConversationTimeline split builders", () => {
  it("composes from the committed + active-run split builders", () => {
    const transcript: TranscriptItem[] = [
      { id: "entry_user", role: "user", text: "Go" },
      { id: "entry_failed", role: "assistant", text: "Agent run failed" },
    ];
    const toolCalls = [
      toolCall("tool_live", "2026-01-01T00:00:01.000Z", "read", undefined, {
        status: "running",
      }),
    ];
    const run = activeRun({
      status: "retrying",
      retry: { ...RETRY, failedEntryId: "entry_failed" },
    });

    const committed = buildCommittedTimeline(transcript, toolCalls);
    const expected = [
      ...selectVisibleCommitted(
        committed.items,
        run,
        undefined,
        committed.context,
      ),
      ...buildActiveRunTimeline(run, undefined, committed.context),
    ];

    assert.deepEqual(
      keys(buildConversationTimeline(transcript, toolCalls, run)),
      keys(expected),
    );
  });

  it("appends one continuable status for an interrupted active run", () => {
    const run = activeRun({
      status: "interrupted",
      recovery: {
        errorMessage: "Host restarted during active execution",
        continuable: true,
      },
    });
    const committed = buildCommittedTimeline(
      [{ id: "entry_user", role: "user", text: "Go" }],
      [],
    );
    const timeline = buildConversationTimeline(
      [{ id: "entry_user", role: "user", text: "Go" }],
      [],
      run,
    );

    assert.deepEqual(keys(timeline), ["entry_user", `run-status:${run.runId}`]);
    const active = buildActiveRunTimeline(run, undefined, committed.context);
    assert.deepEqual(active[0], {
      kind: "run_status",
      key: `run-status:${run.runId}`,
      notice: {
        conversationId: run.conversationId,
        agentId: run.agentId,
        runId: run.runId,
        state: "interrupted",
        errorMessage: "Host restarted during active execution",
        retryable: true,
      },
    });

    const persisted = buildCommittedTimeline(
      [
        {
          id: "entry_status",
          role: "system",
          text: "Interrupted",
          runId: run.runId,
          runStatus: {
            entryId: "entry_status",
            runId: run.runId,
            state: "interrupted",
            retryable: true,
          },
        },
      ],
      [],
    );
    assert.deepEqual(
      buildActiveRunTimeline(run, undefined, persisted.context),
      [],
    );
  });

  it("keeps active-run reasoning immediately before each completed tool", () => {
    const transcript: TranscriptItem[] = [
      { id: "entry_user", role: "user", text: "Inspect the project" },
    ];
    const toolCalls = [
      toolCall(
        "tool_first",
        "2026-01-01T00:00:01.000Z",
        "read",
        "provider_first",
        {
          runId: "run_active",
          liveMessageId: "msg_first",
          contentIndex: 1,
          status: "completed",
        },
      ),
      toolCall(
        "tool_second",
        "2026-01-01T00:00:03.000Z",
        "bash",
        "provider_second",
        {
          runId: "run_active",
          liveMessageId: "msg_second",
          contentIndex: 1,
          status: "completed",
        },
      ),
    ];
    const run = activeRun({
      runId: "run_active",
      turns: [
        runTurn("turn_1", 0, [
          liveMessage(
            "msg_first",
            0,
            [
              textBlock(
                "thinking",
                0,
                "I should inspect the file first.",
                true,
              ),
            ],
            "2026-01-01T00:00:00.000Z",
          ),
          liveMessage(
            "msg_second",
            1,
            [
              textBlock(
                "thinking",
                0,
                "Now I should run the focused check.",
                true,
              ),
            ],
            "2026-01-01T00:00:02.000Z",
          ),
        ]),
      ],
    });

    const committed = buildCommittedTimeline(transcript, toolCalls, {
      includeUnanchoredTerminalToolCalls: false,
    });
    const timeline = [
      ...selectVisibleCommitted(
        committed.items,
        run,
        undefined,
        committed.context,
      ),
      ...buildActiveRunTimeline(run, undefined, committed.context),
    ];

    assert.deepEqual(keys(timeline), [
      "entry_user",
      "live:msg_first:thinking:0",
      "tool-slot:msg_first:1",
      "live:msg_second:thinking:0",
      "tool-slot:msg_second:1",
    ]);
  });

  it("keeps the committed pass independent of run state", () => {
    const transcript: TranscriptItem[] = [
      { id: "entry_user", role: "user", text: "Go" },
      { id: "entry_failed", role: "assistant", text: "Agent run failed" },
    ];
    const committed = buildCommittedTimeline(transcript, []);
    // The failed entry is only hidden once run state references it.
    assert.deepEqual(keys(committed.items), ["entry_user", "entry_failed"]);
    assert.deepEqual(
      keys(
        selectVisibleCommitted(
          committed.items,
          activeRun({
            status: "retrying",
            retry: { ...RETRY, failedEntryId: "entry_failed" },
          }),
          undefined,
          committed.context,
        ),
      ),
      ["entry_user"],
    );
  });

  it("hides all failed attempts of the active run across consecutive retries", () => {
    const transcript: TranscriptItem[] = [
      { id: "entry_user", role: "user", text: "Go" },
      {
        id: "entry_failed_1",
        runId: "run_retry",
        role: "assistant",
        text: "Agent run failed",
        stopReason: "error",
      },
      {
        id: "entry_failed_2",
        runId: "run_retry",
        role: "assistant",
        text: "Agent run failed",
        stopReason: "error",
      },
    ];
    const committed = buildCommittedTimeline(transcript, []);
    // Second retry references only the latest failure; the earlier one is
    // hidden by the run-scoped assistant-error rule.
    assert.deepEqual(
      keys(
        selectVisibleCommitted(
          committed.items,
          activeRun({
            runId: "run_retry",
            status: "retrying",
            retry: { ...RETRY, attempt: 2, failedEntryId: "entry_failed_2" },
          }),
          undefined,
          committed.context,
        ),
      ),
      ["entry_user"],
    );
    // The failures stay hidden while the successful attempt streams.
    assert.deepEqual(
      keys(
        selectVisibleCommitted(
          committed.items,
          activeRun({ runId: "run_retry", status: "running" }),
          undefined,
          committed.context,
        ),
      ),
      ["entry_user"],
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
