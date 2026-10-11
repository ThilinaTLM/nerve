import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  compactionDraftError,
  compactionSourceLabel,
  compactionSummary,
  compactionsEqual,
  INSTRUCTIONS_MAX_BYTES,
  instructionsOverLimit,
  instructionsPatch,
  instructionsSummary,
} from "./conversation-settings";

const base = {
  auto: true,
  profile: "balanced" as const,
  customTriggerPercent: 80,
  customKeepRecentPercent: 15,
};

describe("compaction", () => {
  it("summarizes profiles, custom thresholds and off", () => {
    assert.equal(compactionSummary(base), "Balanced");
    assert.equal(compactionSummary({ ...base, auto: false }), "Off");
    assert.equal(
      compactionSummary({
        ...base,
        profile: "custom",
        customTriggerPercent: 75,
        customKeepRecentPercent: 20,
      }),
      "Custom · 75% / 20%",
    );
  });

  it("labels the source", () => {
    assert.equal(compactionSourceLabel("user"), "inherited from user");
    assert.equal(
      compactionSourceLabel("conversation"),
      "override for this conversation",
    );
  });

  it("validates custom bounds and compares drafts", () => {
    assert.equal(compactionDraftError(base), undefined);
    assert.match(
      compactionDraftError({ ...base, customTriggerPercent: 95 }) ?? "",
      /Compact at/,
    );
    assert.match(
      compactionDraftError({ ...base, customKeepRecentPercent: 1 }) ?? "",
      /Retain recent/,
    );
    assert.equal(compactionsEqual(base, { ...base }), true);
    assert.equal(compactionsEqual(base, { ...base, auto: false }), false);
  });
});

describe("instructions", () => {
  it("summarizes and clears blank text", () => {
    assert.equal(instructionsSummary(null), "None");
    assert.equal(instructionsSummary("  "), "None");
    assert.equal(instructionsSummary("Be terse\nmore"), "13 B · Be terse");
    assert.equal(instructionsPatch("   "), null);
    assert.equal(instructionsPatch("x"), "x");
  });

  it("counts UTF-8 bytes against the limit", () => {
    assert.equal(
      instructionsOverLimit("a".repeat(INSTRUCTIONS_MAX_BYTES)),
      false,
    );
    assert.equal(
      instructionsOverLimit("é".repeat(INSTRUCTIONS_MAX_BYTES / 2 + 1)),
      true,
    );
  });
});
