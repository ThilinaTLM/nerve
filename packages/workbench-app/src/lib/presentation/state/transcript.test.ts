import type { ConversationEntry } from "@nervekit/contracts/conversations";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
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
  it("retains an empty assistant message's durable error", () => {
    const [item] = entryToTranscriptItems(
      entry({
        role: "assistant",
        kind: "message",
        text: "",
        details: {
          stopReason: "error",
          errorMessage: "401: Insufficient balance",
        },
      }),
    );

    assert.equal(item?.text, "");
    assert.equal(item?.stopReason, "error");
    assert.equal(item?.errorMessage, "401: Insufficient balance");
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
});
