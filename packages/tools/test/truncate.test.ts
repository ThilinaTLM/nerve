import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  truncateHead,
  truncateLine,
  truncateTail,
} from "../src/execution/truncate.js";

describe("PI-style truncation helpers", () => {
  it("truncates head output by line count", () => {
    const result = truncateHead("one\ntwo\nthree", {
      maxLines: 2,
      maxBytes: 1024,
    });
    assert.equal(result.text, "one\ntwo");
    assert.equal(result.truncated, true);
    assert.equal(result.omittedLines, 1);
  });

  it("truncates tail output by line count", () => {
    const result = truncateTail("one\ntwo\nthree", {
      maxLines: 2,
      maxBytes: 1024,
    });
    assert.equal(result.text, "two\nthree");
    assert.equal(result.truncated, true);
    assert.equal(result.omittedLines, 1);
  });

  it("truncates long grep lines", () => {
    const result = truncateLine("x".repeat(8), 4);
    assert.equal(result.truncated, true);
    assert.match(result.text, /^xxxx…\[truncated 4 chars\]$/);
  });
});
