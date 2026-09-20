import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CompactionNotice } from "../../state/transcript-types";
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
