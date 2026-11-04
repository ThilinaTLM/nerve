import assert from "node:assert/strict";
import { test } from "node:test";
import {
  pruneSelection,
  selectOnly,
  selectRange,
  toggleSelected,
} from "./file-explorer-selection";

const visible = ["a", "b", "c", "d"];

test("toggles single entries and moves the anchor", () => {
  const selection = toggleSelected(selectOnly("a"), "c");
  assert.deepEqual([...selection.ids], ["a", "c"]);
  assert.equal(selection.anchorId, "c");
  assert.deepEqual([...toggleSelected(selection, "a").ids], ["c"]);
});

test("selects ranges from the anchor in either direction", () => {
  const forward = selectRange(visible, selectOnly("b"), "d");
  assert.deepEqual([...forward.ids], ["b", "c", "d"]);
  assert.equal(forward.anchorId, "b");
  assert.deepEqual([...selectRange(visible, selectOnly("c"), "a").ids], [
    "a",
    "b",
    "c",
  ]);
  assert.deepEqual([...selectRange(visible, { ids: new Set() }, "b").ids], ["b"]);
});

test("prunes ids that disappeared", () => {
  const selection = selectRange(visible, selectOnly("a"), "c");
  assert.deepEqual([...pruneSelection(selection, new Set(["a", "c"])).ids], [
    "a",
    "c",
  ]);
  assert.equal(pruneSelection(selection, new Set(visible)), selection);
});
