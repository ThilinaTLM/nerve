import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ConversationEntry } from "@nervekit/shared";
import { entryToTranscriptItems } from "./transcript";

function entry(overrides: Partial<ConversationEntry>): ConversationEntry {
  return {
    id: "entry_01H000000000000000000000",
    conversationId: "conv_01H00000000000000000000000",
    role: "system",
    kind: "run_status",
    text: "Model request failed after 3 retries.",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  } as ConversationEntry;
}

describe("entryToTranscriptItems", () => {
  it("converts compaction entries into transcript compaction items", () => {
    const [item] = entryToTranscriptItems(
      entry({
        kind: "compaction",
        text: "summary text",
        summary: "summary markdown",
        tokensBefore: 180_000,
        firstKeptEntryId: "entry_kept",
        details: {
          reason: "threshold",
          compactedMessages: 12,
          tokensAfter: 24_000,
          freedTokens: 156_000,
          policy: {
            contextWindow: 200_000,
            thresholdTokens: 180_000,
            keepRecentTokens: 20_000,
          },
        },
      }),
    );

    assert.equal(item?.kind, "compaction");
    assert.equal(item?.compaction?.state, "completed");
    assert.equal(item?.compaction?.reason, "threshold");
    assert.equal(item?.compaction?.summary, "summary markdown");
    assert.equal(item?.compaction?.tokensBefore, 180_000);
    assert.equal(item?.compaction?.tokensAfter, 24_000);
    assert.equal(item?.compaction?.freedTokens, 156_000);
    assert.equal(item?.compaction?.contextWindow, 200_000);
    assert.equal(item?.compaction?.firstKeptEntryId, "entry_kept");
  });

  it("derives freedTokens from before/after when not persisted", () => {
    const [item] = entryToTranscriptItems(
      entry({
        kind: "compaction",
        text: "summary text",
        summary: "summary markdown",
        tokensBefore: 180_000,
        firstKeptEntryId: "entry_kept",
        details: { reason: "manual", tokensAfter: 30_000 },
      }),
    );

    assert.equal(item?.compaction?.tokensAfter, 30_000);
    assert.equal(item?.compaction?.freedTokens, 150_000);
  });

  it("converts run status entries into transcript status items", () => {
    const [item] = entryToTranscriptItems(
      entry({
        details: {
          type: "agent_run_retry_status",
          state: "retry_exhausted",
          runId: "run_01H00000000000000000000000",
          failedEntryId: "entry_failed",
          attempt: 3,
          maxRetries: 3,
          errorMessage: "timeout",
          retryable: true,
        },
      }),
    );

    assert.equal(item?.role, "system");
    assert.equal(item?.kind, "run_status");
    assert.equal(item?.runStatus?.state, "retry_exhausted");
    assert.equal(item?.runStatus?.failedEntryId, "entry_failed");
    assert.equal(item?.runStatus?.retryable, true);
  });

  it("converts failed run status entries into transcript status items", () => {
    const [item] = entryToTranscriptItems(
      entry({
        text: "Agent run failed.",
        details: {
          type: "agent_run_retry_status",
          state: "failed",
          runId: "run_01H00000000000000000000000",
          failedEntryId: "entry_failed",
          errorMessage: "unexpected error",
          retryable: true,
        },
      }),
    );

    assert.equal(item?.kind, "run_status");
    assert.equal(item?.runStatus?.state, "failed");
    assert.equal(item?.runStatus?.failedEntryId, "entry_failed");
    assert.equal(item?.runStatus?.retryable, true);
  });

  it("converts interrupted run status entries into transcript status items", () => {
    const [item] = entryToTranscriptItems(
      entry({
        text: "Agent run was interrupted because the Nerve daemon restarted.",
        details: {
          type: "agent_run_retry_status",
          state: "interrupted",
          runId: "run_01H00000000000000000000000",
          errorMessage:
            "Agent run was interrupted because the Nerve daemon restarted.",
          retryable: true,
        },
      }),
    );

    assert.equal(item?.kind, "run_status");
    assert.equal(item?.runStatus?.state, "interrupted");
    assert.equal(item?.runStatus?.failedEntryId, undefined);
    assert.equal(item?.runStatus?.retryable, true);
  });

  it("converts task event entries into system transcript items", () => {
    const [item] = entryToTranscriptItems(
      entry({
        kind: "task_event",
        text: "Background task typecheck failed.",
        details: {
          type: "task_event",
          source: "harness",
          taskId: "task_123",
          taskName: "typecheck",
          groupId: "taskgrp_123",
          event: "failed",
          status: "failed",
          nextCursor: 42,
        },
      }),
    );

    assert.equal(item?.role, "system");
    assert.equal(item?.kind, "task_event");
    assert.equal(item?.text, "Background task typecheck failed.");
    assert.equal(item?.taskEvent?.taskId, "task_123");
    assert.equal(item?.taskEvent?.taskName, "typecheck");
    assert.equal(item?.taskEvent?.groupId, "taskgrp_123");
    assert.equal(item?.taskEvent?.event, "failed");
    assert.equal(item?.taskEvent?.nextCursor, 42);
  });
});
