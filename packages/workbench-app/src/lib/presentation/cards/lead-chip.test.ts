import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatClock,
  formatFinalDuration,
  leadChip,
  riskChip,
  type LeadStage,
} from "./lead-chip";

const text = (stage: LeadStage, extra = {}) =>
  leadChip({ stage, nowMs: 0, ...extra });

describe("lead chip", () => {
  it("morphs through the pre-run stages under one key", () => {
    const chips = (
      ["drafting", "supervising", "approval", "queued"] as const
    ).map((stage) => text(stage));
    assert.deepEqual(
      chips.map((chip) => chip.text),
      ["drafting", "checking", "needs approval", "queued"],
    );
    assert.deepEqual(
      chips.map((chip) => chip.tone),
      [undefined, undefined, "warning", "info"],
    );
    assert.equal(new Set(chips.map((chip) => chip.key)).size, 1);
  });

  it("shows a live clock from execution start", () => {
    const chip = text("running", { startedAtMs: 1_000, nowMs: 66_500 });
    assert.equal(chip.text, "1:05");
    assert.equal(chip.tone, "info");
    assert.equal(text("running", { nowMs: 5_000 }).text, "0:00");
  });

  it("shows the final duration, or the terminal label when unknown", () => {
    assert.equal(
      text("completed", { startedAtMs: 0, settledAtMs: 4_200 }).text,
      "4.2s",
    );
    const failed = text("failed", { startedAtMs: 0, settledAtMs: 840 });
    assert.equal(failed.text, "840ms");
    assert.equal(text("completed").text, "completed");
    assert.deepEqual(text("failed"), {
      key: "lead",
      text: "failed",
      tone: "destructive",
    });
  });

  it("labels the non-duration ends", () => {
    assert.equal(text("denied").text, "denied");
    assert.equal(text("cancelled").text, "cancelled");
    assert.equal(text("dismissed").text, "dismissed");
    assert.equal(text("waiting_for_user").tone, "warning");
  });

  it("formats clocks and durations", () => {
    assert.equal(formatClock(3_725_000), "1:02:05");
    assert.equal(formatFinalDuration(65_000), "1m 05s");
  });
});

describe("risk chip", () => {
  it("appears only when approval was required", () => {
    assert.equal(
      riskChip({ decision: "allow", effectiveRisk: "destructive" }),
      undefined,
    );
    assert.equal(riskChip(null), undefined);
    assert.deepEqual(
      riskChip({ decision: "approval", effectiveRisk: "destructive" }),
      { key: "risk", text: "destructive", tone: "destructive" },
    );
    assert.equal(
      riskChip({ decision: "approval", effectiveRisk: "workspace_write" })
        ?.tone,
      "warning",
    );
  });
});
