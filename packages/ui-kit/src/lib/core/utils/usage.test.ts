import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatDurationMinutes,
  formatResetAfterSeconds,
  usageWindowDisplay,
} from "./usage";

describe("usage window display metadata", () => {
  const fallback = { label: "Usage", abbreviation: "U" };

  it("recognizes common rate-limit durations", () => {
    assert.deepEqual(usageWindowDisplay(300, fallback), {
      label: "Session",
      abbreviation: "S",
    });
    assert.deepEqual(usageWindowDisplay(1_440, fallback), {
      label: "Daily",
      abbreviation: "D",
    });
    assert.deepEqual(usageWindowDisplay(10_080, fallback), {
      label: "Weekly",
      abbreviation: "W",
    });
    assert.deepEqual(usageWindowDisplay(43_200, fallback), {
      label: "Monthly",
      abbreviation: "M",
    });
    assert.deepEqual(usageWindowDisplay(525_600, fallback), {
      label: "Annual",
      abbreviation: "A",
    });
  });

  it("allows five percent duration variance", () => {
    assert.equal(usageWindowDisplay(285, fallback).label, "Session");
    assert.equal(usageWindowDisplay(315, fallback).label, "Session");
    assert.equal(usageWindowDisplay(9_576, fallback).label, "Weekly");
    assert.equal(usageWindowDisplay(10_584, fallback).label, "Weekly");
  });

  it("uses the supplied fallback for unknown or missing durations", () => {
    assert.equal(usageWindowDisplay(316, fallback), fallback);
    assert.equal(usageWindowDisplay(null, fallback), fallback);
    assert.equal(usageWindowDisplay(Number.NaN, fallback), fallback);
  });
});

describe("usage duration formatting", () => {
  it("formats minute durations with days, hours, and minutes", () => {
    assert.equal(formatDurationMinutes(0), "0m");
    assert.equal(formatDurationMinutes(59), "59m");
    assert.equal(formatDurationMinutes(60), "1h");
    assert.equal(formatDurationMinutes(61), "1h 1m");
    assert.equal(formatDurationMinutes(300), "5h");
    assert.equal(formatDurationMinutes(1_440), "1d");
    assert.equal(formatDurationMinutes(10_080), "7d");
    assert.equal(formatDurationMinutes(6_476), "4d 11h 56m");
  });

  it("ignores null, negative, and non-finite minute durations", () => {
    assert.equal(formatDurationMinutes(null), null);
    assert.equal(formatDurationMinutes(undefined), null);
    assert.equal(formatDurationMinutes(-1), null);
    assert.equal(formatDurationMinutes(Number.NaN), null);
  });

  it("formats reset countdowns with day-aware durations", () => {
    assert.equal(formatResetAfterSeconds(6_476 * 60), "4d 11h 56m");
    assert.equal(formatResetAfterSeconds(10_080 * 60), "7d");
    assert.equal(formatResetAfterSeconds(0), null);
  });
});
