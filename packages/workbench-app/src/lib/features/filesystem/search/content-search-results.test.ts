import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSearchResultItems,
  parseGlobList,
  previewMatch,
} from "./content-search-results";

test("previewMatch trims indentation and shifts ranges", () => {
  assert.deepEqual(
    previewMatch({ line: 1, text: "    foo bar", ranges: [[8, 11]] }),
    {
      text: "foo bar",
      ranges: [[4, 7]],
    },
  );
});

test("previewMatch elides a distant lead-in", () => {
  const text = `${"x".repeat(60)}needle tail`;
  const preview = previewMatch({ line: 1, text, ranges: [[60, 66]] });
  assert.ok(preview.text.startsWith("…"));
  const [start, end] = preview.ranges[0]!;
  assert.equal(preview.text.slice(start, end), "needle");
});

test("buildSearchResultItems nests matches under files", () => {
  const items = buildSearchResultItems([
    {
      path: "a.ts",
      matches: [
        { line: 3, text: "hit", ranges: [[0, 3]] },
        { line: 9, text: "hit", ranges: [[0, 3]] },
      ],
    },
  ]);
  assert.equal(items.length, 3);
  assert.equal(items[0]?.type, "file");
  assert.equal(items[1]?.parentKey, items[0]?.key);
});

test("parseGlobList", () => {
  assert.equal(parseGlobList("  "), undefined);
  assert.deepEqual(parseGlobList("src/**, !*.test.ts"), [
    "src/**",
    "!*.test.ts",
  ]);
});
