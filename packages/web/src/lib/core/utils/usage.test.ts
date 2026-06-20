import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatDurationMinutes,
  formatResetAfterSeconds,
} from "$lib/core/utils/usage";

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
