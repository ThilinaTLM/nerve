import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  parseToolExecutionResult,
  splitLogicalLines,
  tailLogicalText,
} from "./tool-view-helpers.js";

describe("tailLogicalText", () => {
  it("matches the existing split-and-tail semantics", () => {
    const samples = [
      "",
      "one",
      "one\n",
      "one\ntwo\nthree",
      "one\r\ntwo\r\nthree\r\n",
      "one\n\nthree\n",
    ];
    for (const sample of samples) {
      for (const count of [1, 2, 6]) {
        const lines = splitLogicalLines(sample);
        const expected =
          lines.length <= count
            ? sample
            : lines.slice(lines.length - count).join("\n");
        assert.equal(tailLogicalText(sample, count), expected);
      }
    }
  });
});

describe("stored image results", () => {
  it("retains asset references without requiring inline image bytes", () => {
    const result = {
      contentBlocks: [
        { type: "image", assetId: "asset_image", mimeType: "image/png" },
      ],
    };
    assert.deepEqual(parseToolExecutionResult(result), result);
  });
});
