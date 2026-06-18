import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { trimTextPreview } from "./text-preview";

describe("trimTextPreview", () => {
  it("keeps short text unchanged", () => {
    const preview = trimTextPreview("one\ntwo", {
      headLines: 2,
      tailLines: 1,
      maxChars: 100,
    });

    assert.equal(preview.text, "one\ntwo");
    assert.equal(preview.trimmed, false);
    assert.equal(preview.omittedLines, 0);
    assert.equal(preview.omittedChars, 0);
  });

  it("keeps head and tail lines with an omission marker", () => {
    const source = Array.from(
      { length: 10 },
      (_, index) => `line-${index + 1}`,
    ).join("\n");
    const preview = trimTextPreview(source, {
      headLines: 3,
      tailLines: 2,
      maxChars: 1_000,
    });

    assert.equal(preview.trimmed, true);
    assert.equal(preview.omittedLines, 5);
    assert.match(preview.text, /^line-1\nline-2\nline-3\n… 5 lines/);
    assert.match(preview.text, /line-9\nline-10$/);
    assert.equal(preview.text.includes("line-4"), false);
  });

  it("trims very long text by character budget", () => {
    const preview = trimTextPreview("a".repeat(120), {
      headLines: 10,
      tailLines: 2,
      maxChars: 60,
    });

    assert.equal(preview.trimmed, true);
    assert.ok(preview.text.length <= 60);
    assert.match(preview.text, /chars omitted/);
  });
});
