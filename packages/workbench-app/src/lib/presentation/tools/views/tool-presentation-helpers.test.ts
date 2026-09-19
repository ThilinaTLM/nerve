import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatElapsed } from "./tool-presentation-helpers";

describe("formatElapsed", () => {
  it("counts seconds for short work", () => {
    assert.equal(formatElapsed(0), "0s");
    assert.equal(formatElapsed(2_400), "2s");
    assert.equal(formatElapsed(59_900), "59s");
  });

  it("switches to a stopwatch once a minute passes", () => {
    assert.equal(formatElapsed(60_000), "1:00");
    assert.equal(formatElapsed(125_000), "2:05");
    assert.equal(formatElapsed(59 * 60_000 + 59_000), "59:59");
  });

  it("adds hours for very long work", () => {
    assert.equal(formatElapsed(3_600_000), "1:00:00");
    assert.equal(formatElapsed(3_725_000), "1:02:05");
  });
});
