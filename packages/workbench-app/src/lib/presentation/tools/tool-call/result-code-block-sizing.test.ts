import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { shouldMeasureInlineSize } from "./result-code-block-sizing";

describe("result code block sizing", () => {
  it("measures the first usable inline size and later width changes", () => {
    assert.equal(shouldMeasureInlineSize(undefined, 640), true);
    assert.equal(shouldMeasureInlineSize(640, 520), true);
  });

  it("ignores unchanged, subpixel, and unusable inline sizes", () => {
    assert.equal(shouldMeasureInlineSize(640, 640), false);
    assert.equal(shouldMeasureInlineSize(640, 640.5), false);
    assert.equal(shouldMeasureInlineSize(undefined, 0), false);
    assert.equal(shouldMeasureInlineSize(undefined, Number.NaN), false);
  });
});
