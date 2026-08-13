import assert from "node:assert/strict";
import test from "node:test";
import { insertionIndexAtX, moveTabKey } from "./editor-tab-reorder";

const keys = ["a", "b", "c", "d"];

test("moves a tab left and right using final visual indices", () => {
  assert.deepEqual(moveTabKey(keys, "c", 0), ["c", "a", "b", "d"]);
  assert.deepEqual(moveTabKey(keys, "a", 2), ["b", "c", "a", "d"]);
});

test("clamps a tab to the first or last position", () => {
  assert.deepEqual(moveTabKey(keys, "b", -10), ["b", "a", "c", "d"]);
  assert.deepEqual(moveTabKey(keys, "b", 99), ["a", "c", "d", "b"]);
});

test("keeps the order when the destination is unchanged", () => {
  assert.deepEqual(moveTabKey(keys, "b", 1), keys);
  assert.deepEqual(moveTabKey(keys, "missing", 1), keys);
});

test("resolves insertion positions around tab midpoints", () => {
  const bounds = [
    { key: "a", left: 0, width: 100 },
    { key: "c", left: 100, width: 100 },
    { key: "d", left: 200, width: 100 },
  ];
  assert.equal(insertionIndexAtX(49, bounds), 0);
  assert.equal(insertionIndexAtX(50, bounds), 1);
  assert.equal(insertionIndexAtX(149, bounds), 1);
  assert.equal(insertionIndexAtX(250, bounds), 3);
});
