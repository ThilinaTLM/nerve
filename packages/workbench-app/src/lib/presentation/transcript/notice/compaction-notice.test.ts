import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CompactionNotice } from "../../state/transcript-types";
import { conversationEntrySchema } from "@nervekit/contracts/conversations";
import { entryToTranscriptItem } from "../../state/transcript";
import { compactionNoticeHeader } from "./compaction-notice";

function notice(state: CompactionNotice["state"]): CompactionNotice {
  return {
    state,
    reason: "manual",
  } as CompactionNotice;
}

describe("compaction notice header", () => {
  it("uses snake-case names in the mono event slot", () => {
    assert.equal(compactionNoticeHeader(notice("running")).badge, "compacting");
    assert.equal(
      compactionNoticeHeader(notice("cancelled")).badge,
      "compact_stopped",
    );
    assert.equal(
      compactionNoticeHeader(notice("failed")).badge,
      "compact_failed",
    );
    assert.equal(
      compactionNoticeHeader(notice("completed")).badge,
      "compacted",
    );
  });

  it("keeps accessible status labels in natural language", () => {
    assert.equal(
      compactionNoticeHeader(notice("failed")).statusLabel,
      "Compaction failed",
    );
  });
});

it("renders coded failures as terminal warnings and uncoded failures as errors", () => {
  for (const code of [
    "ineffective",
    "stale",
    "pending_work",
    "no_new_history",
  ] as const) {
    const header = compactionNoticeHeader({ ...notice("failed"), code });
    assert.equal(header.tone, "warning");
    assert.equal(header.busy, false);
  }
  assert.equal(compactionNoticeHeader(notice("failed")).tone, "destructive");
  assert.equal(compactionNoticeHeader(notice("cancelled")).busy, false);
});

it("warns only when completed context is known to remain at or above threshold", () => {
  for (const tokensAfter of [100, 101]) {
    const header = compactionNoticeHeader({
      ...notice("completed"),
      tokensAfter,
      thresholdTokens: 100,
    });
    assert.equal(header.tone, "warning");
    assert.equal(header.busy, false);
    assert.match(header.statusLabel, /Insufficient context reduction/);
  }
  for (const metrics of [
    {},
    { tokensAfter: 100 },
    { thresholdTokens: 100 },
    { tokensAfter: 99, thresholdTokens: 100 },
  ]) {
    assert.equal(
      compactionNoticeHeader({ ...notice("completed"), ...metrics }).tone,
      "success",
    );
  }
});

it("warns for persisted over-threshold checkpoints without inferring missing metrics", () => {
  for (const details of [
    { tokensAfter: 110, policy: { thresholdTokens: 100 } },
    { tokensAfter: 110 },
    { policy: { thresholdTokens: 100 } },
  ]) {
    const entry = conversationEntrySchema.parse({
      id: "entry_compaction",
      conversationId: "conv_test",
      kind: "compaction",
      role: "system",
      text: "Summary",
      tokensBefore: 120,
      createdAt: "2026-01-01T00:00:00.000Z",
      details,
    });
    const historical = entryToTranscriptItem(entry)?.compaction;
    assert.ok(historical);
    assert.equal(historical.state, "completed");
    assert.equal(
      compactionNoticeHeader(historical).tone,
      "tokensAfter" in details && "policy" in details ? "warning" : "success",
    );
  }
});
