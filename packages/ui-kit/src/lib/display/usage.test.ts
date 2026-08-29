import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatTokens } from "./usage.js";

describe("formatTokens", () => {
  it("formats token counts with compact human-readable units", () => {
    assert.equal(formatTokens(999), "999");
    assert.equal(formatTokens(1_250), "1.3k");
    assert.equal(formatTokens(25_400), "25k");
    assert.equal(formatTokens(1_250_000), "1.3M");
    assert.equal(formatTokens(25_400_000), "25M");
    assert.equal(formatTokens(1_250_000_000), "1.3B");
    assert.equal(formatTokens(25_400_000_000), "25B");
    assert.equal(formatTokens(1_250_000_000_000), "1.3T");
    assert.equal(formatTokens(25_400_000_000_000), "25T");
  });
});
