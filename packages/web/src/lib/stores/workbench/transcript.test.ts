import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ConversationEntry } from "../../api";
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
    assert.equal(item?.compaction?.contextWindow, 200_000);
    assert.equal(item?.compaction?.firstKeptEntryId, "entry_kept");
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
});
