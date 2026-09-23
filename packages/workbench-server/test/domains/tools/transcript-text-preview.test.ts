import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  firstLines,
  lastLines,
  textOverflowStats,
} from "../../../src/domains/tools/artifacts/transcript-text-preview.js";

const lines = (count: number) =>
  Array.from({ length: count }, (_, index) => `line ${index + 1}`).join("\n");

describe("transcript text preview", () => {
  it("keeps head and tail lines and reports hidden lines", () => {
    const head = firstLines(lines(10), 3);
    assert.equal(head.value, "line 1\nline 2\nline 3");
    assert.deepEqual(textOverflowStats([head]), { hidden: 7, noun: "lines" });

    const tail = lastLines(lines(10), 3);
    assert.equal(tail.value, "line 8\nline 9\nline 10");
    assert.deepEqual(textOverflowStats([tail]), { hidden: 7, noun: "lines" });
  });

  it("reports characters when a single long line is truncated", () => {
    const preview = firstLines("x".repeat(100), 6, 40);
    assert.equal(preview.value, "x".repeat(40));
    assert.deepEqual(textOverflowStats([preview]), {
      hidden: 60,
      noun: "characters",
    });
  });

  it("does not count a trailing newline as a hidden line", () => {
    const head = firstLines("a\nb\n", 2);
    assert.equal(head.value, "a\nb");
    assert.equal(head.hiddenLines, 0);
    const tail = lastLines("a\nb\n", 2);
    assert.equal(tail.value, "a\nb");
    assert.equal(tail.hiddenLines, 0);
  });
});
