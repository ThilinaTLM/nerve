import assert from "node:assert/strict";
import test from "node:test";
import { rangesFromPositions, segmentsFromRanges } from "./highlight-segments";

test("segmentsFromRanges merges overlaps and clamps", () => {
  assert.deepEqual(
    segmentsFromRanges("abcdef", [
      [3, 5],
      [1, 3],
      [4, 99],
    ]),
    [
      { text: "a", match: false },
      { text: "bcdef", match: true },
    ],
  );
});

test("segmentsFromRanges keeps trailing plain text", () => {
  assert.deepEqual(segmentsFromRanges("abcd", [[1, 2]]), [
    { text: "a", match: false },
    { text: "b", match: true },
    { text: "cd", match: false },
  ]);
});

test("rangesFromPositions merges adjacent indices and applies offset", () => {
  assert.deepEqual(rangesFromPositions([5, 6, 7, 9]), [
    [5, 8],
    [9, 10],
  ]);
  assert.deepEqual(rangesFromPositions([1, 5, 6], 4), [[1, 3]]);
});
