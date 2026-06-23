import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { TranscriptItem } from "$lib/core/types/state-types";
import {
  buildCommittedTimeline,
  buildConversationTimeline,
  buildLiveTimeline,
  selectVisibleCommitted,
} from "./timeline";
import { keys, liveState, toolCall } from "./timeline.fixtures";

describe("buildConversationTimeline split builders", () => {
  it("composes from the committed + live split builders", () => {
    const transcript: TranscriptItem[] = [
      { id: "entry_user", role: "user", text: "Go" },
      { id: "entry_failed", role: "assistant", text: "Agent run failed" },
    ];
    const toolCalls = [
      toolCall("tool_live", "2026-01-01T00:00:01.000Z", "read", undefined, {
        status: "running",
      }),
    ];
    const live = liveState({
      runStatus: {
        state: "retrying",
        runId: "run_01H00000000000000000000000",
        failedEntryId: "entry_failed",
        attempt: 1,
        maxRetries: 3,
      },
    });

    const committed = buildCommittedTimeline(transcript, toolCalls);
    const expected = [
      ...selectVisibleCommitted(committed.items, live),
      ...buildLiveTimeline(live, committed.context),
    ];

    assert.deepEqual(
      keys(buildConversationTimeline(transcript, toolCalls, live)),
      keys(expected),
    );
  });

  it("keeps the committed pass independent of live state", () => {
    const transcript: TranscriptItem[] = [
      { id: "entry_user", role: "user", text: "Go" },
      { id: "entry_failed", role: "assistant", text: "Agent run failed" },
    ];
    const committed = buildCommittedTimeline(transcript, []);
    // The failed entry is only hidden once live state references it.
    assert.deepEqual(keys(committed.items), ["entry_user", "entry_failed"]);
    assert.deepEqual(
      keys(
        selectVisibleCommitted(
          committed.items,
          liveState({
            runStatus: {
              state: "retrying",
              runId: "run_01H00000000000000000000000",
              failedEntryId: "entry_failed",
              attempt: 1,
              maxRetries: 3,
            },
          }),
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
