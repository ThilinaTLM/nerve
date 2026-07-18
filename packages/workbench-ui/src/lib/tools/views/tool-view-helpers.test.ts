import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  countLogicalLines,
  splitLogicalLines,
  tail,
} from "./tool-view-helpers";

describe("logical tool output lines", () => {
  it("handles empty, unterminated, and singly terminated text", () => {
    assert.deepEqual(splitLogicalLines(""), []);
    assert.equal(countLogicalLines(""), 0);

    assert.deepEqual(splitLogicalLines("first\nsecond"), ["first", "second"]);
    assert.equal(countLogicalLines("first\nsecond"), 2);

    assert.deepEqual(splitLogicalLines("first\nsecond\n"), ["first", "second"]);
    assert.equal(countLogicalLines("first\nsecond\n"), 2);
  });

  it("preserves intentional blank lines before the final terminator", () => {
    assert.deepEqual(splitLogicalLines("a\n\n"), ["a", ""]);
    assert.equal(countLogicalLines("a\n\n"), 2);
    assert.deepEqual(splitLogicalLines("\n"), [""]);
    assert.equal(countLogicalLines("\n"), 1);
  });

  it("selects six content lines from newline-terminated tail output", () => {
    const output = `${Array.from(
      { length: 7 },
      (_, index) => `line ${index + 1}`,
    ).join("\n")}\n`;

    assert.deepEqual(tail(splitLogicalLines(output), 6), [
      "line 2",
      "line 3",
      "line 4",
      "line 5",
      "line 6",
      "line 7",
    ]);
  });
});
