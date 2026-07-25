import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildConversationTimeline } from "./timeline";
import { activeRun, keys } from "./timeline.fixtures";

const RETRY = {
  attempt: 1,
  maxRetries: 3,
  delayMs: 1000,
  retryAt: "2026-01-01T00:00:05.000Z",
};

describe("buildConversationTimeline status and compaction", () => {
  it("appends live retry status and suppresses the referenced failed assistant", () => {
    const timeline = buildConversationTimeline(
      [
        { id: "entry_user", role: "user", text: "Go" },
        { id: "entry_failed", role: "assistant", text: "Agent run failed" },
      ],
      [],
      activeRun({
        status: "retrying",
        retry: { ...RETRY, failedEntryId: "entry_failed" },
      }),
    );

    assert.deepEqual(keys(timeline), [
      "entry_user",
      "run-status:run_01H00000000000000000000000",
    ]);
    assert.equal(timeline[1]?.kind, "run_status");
  });

  it("keeps the failed entry visible once compaction has failed", () => {
    const timeline = buildConversationTimeline(
      [
        { id: "entry_user", role: "user", text: "Go" },
        { id: "entry_failed", role: "assistant", text: "Too many tokens" },
      ],
      [],
      undefined,
      {
        compaction: {
          id: "live:compaction:run_1:overflow",
          state: "failed",
          reason: "overflow",
          runId: "run_1",
          failedEntryId: "entry_failed",
          errorMessage: "Compaction failed",
        },
      },
    );

    assert.deepEqual(keys(timeline), [
      "entry_user",
      "entry_failed",
      "live:compaction:run_1:overflow",
    ]);
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
      activeRun({
        runId: "run_retry",
        status: "retrying",
        retry: { ...RETRY, attempt: 3 },
      }),
    );

    assert.deepEqual(keys(timeline), ["entry_user", "run-status:run_retry"]);
    assert.equal(
      timeline.filter((item) => item.kind === "run_status").length,
      1,
    );
  });
});
