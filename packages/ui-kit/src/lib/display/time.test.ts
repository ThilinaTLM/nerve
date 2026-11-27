import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatElapsedClock, relativeTimeLabel } from "./time.js";

describe("relative time", () => {
  const now = Date.parse("2026-07-30T12:00:00Z");
  const label = (ts: string | undefined, style?: "compact" | "long") =>
    relativeTimeLabel(ts, { now, style });

  it("scales the unit with the elapsed time", () => {
    assert.equal(label("2026-07-30T11:59:30Z"), "now");
    assert.equal(label("2026-07-30T11:20:00Z"), "40m");
    assert.equal(label("2026-07-30T04:00:00Z"), "8h");
    assert.equal(label("2026-07-24T12:00:00Z"), "6d");
    assert.equal(label("2026-07-16T12:00:00Z"), "2w");
    assert.equal(label("2026-05-01T12:00:00Z"), "3mo");
    assert.equal(label("2025-07-30T12:00:00Z"), "1y");
    assert.equal(label("2023-05-01T12:00:00Z"), "3y");
  });

  it("always rounds down", () => {
    assert.equal(label("2026-07-30T11:59:01Z"), "now");
    assert.equal(label("2026-07-30T11:58:01Z"), "1m");
    assert.equal(label("2026-07-30T10:30:00Z"), "1h");
  });

  it("long style reads as prose", () => {
    assert.equal(label("2026-07-30T11:59:30Z", "long"), "just now");
    assert.equal(label("2026-07-30T11:20:00Z", "long"), "40m ago");
  });

  it("treats future timestamps as now", () => {
    assert.equal(label("2026-07-30T12:05:00Z"), "now");
  });

  it("returns nothing for missing or unparsable timestamps", () => {
    assert.equal(label(undefined), "");
    assert.equal(label("not-a-date"), "");
  });
});

describe("elapsed clock", () => {
  it("shows minutes and padded seconds without rolling over to hours", () => {
    assert.equal(formatElapsedClock(-5), "0:00");
    assert.equal(formatElapsedClock(7_900), "0:07");
    assert.equal(formatElapsedClock(754_000), "12:34");
    assert.equal(formatElapsedClock(4_500_000), "75:00");
  });
});
