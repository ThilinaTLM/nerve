import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildConversationTimeline } from "./timeline";
import {
  activeRun,
  keys,
  liveMessage,
  runTurn,
  textBlock,
} from "./timeline.fixtures";

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

  it("keeps retry-failed assistant hidden while the next attempt streams", () => {
    const timeline = buildConversationTimeline(
      [
        { id: "entry_user", role: "user", text: "Go" },
        {
          id: "entry_failed",
          runId: "run_01H00000000000000000000000",
          role: "assistant",
          text: "Agent run failed",
          stopReason: "error",
        },
      ],
      [],
      activeRun({
        turns: [
          runTurn("turn_1", 0, [
            liveMessage("msg_1", 0, [textBlock("text", 0, "Retry response")]),
          ]),
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

  it("appends running compaction and hides the failed overflow entry", () => {
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
          state: "running",
          reason: "overflow",
          runId: "run_1",
          failedEntryId: "entry_failed",
        },
      },
    );

    assert.deepEqual(keys(timeline), [
      "entry_user",
      "live:compaction:run_1:overflow",
    ]);
    assert.equal(timeline[1]?.kind, "compaction");
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
