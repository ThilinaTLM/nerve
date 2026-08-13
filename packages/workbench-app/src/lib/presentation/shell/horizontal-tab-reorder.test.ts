import assert from "node:assert/strict";
import test from "node:test";
import {
  adjacentTabIndexAtOverlap,
  initialTabIndexAtOverlap,
  moveTabKey,
} from "./horizontal-tab-reorder";

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

const overlapIndex = ({
  orderedKeys = keys,
  draggedKey = "b",
  draggedLeft,
  draggedWidth = 100,
  direction,
  remainingTabs = [
    { key: "a", left: 0, width: 100 },
    { key: "c", left: 200, width: 100 },
    { key: "d", left: 300, width: 100 },
  ],
}: {
  orderedKeys?: readonly string[];
  draggedKey?: string;
  draggedLeft: number;
  draggedWidth?: number;
  direction: -1 | 0 | 1;
  remainingTabs?: readonly { key: string; left: number; width: number }[];
}) =>
  adjacentTabIndexAtOverlap({
    draggedKey,
    orderedKeys,
    draggedLeft,
    draggedWidth,
    direction,
    remainingTabs,
  });

test("moves right when the dragged tab covers at least 60% of its neighbor", () => {
  assert.equal(overlapIndex({ draggedLeft: 159, direction: 1 }), 1);
  assert.equal(overlapIndex({ draggedLeft: 160, direction: 1 }), 2);
  assert.equal(overlapIndex({ draggedLeft: 170, direction: 1 }), 2);
});

test("moves left when the dragged tab covers at least 60% of its neighbor", () => {
  assert.equal(overlapIndex({ draggedLeft: 41, direction: -1 }), 1);
  assert.equal(overlapIndex({ draggedLeft: 40, direction: -1 }), 0);
  assert.equal(overlapIndex({ draggedLeft: 30, direction: -1 }), 0);
});

test("uses the covered tab width for the overlap threshold", () => {
  const remainingTabs = [
    { key: "a", left: 0, width: 100 },
    { key: "c", left: 200, width: 200 },
    { key: "d", left: 400, width: 100 },
  ];
  assert.equal(
    overlapIndex({
      draggedLeft: 219,
      draggedWidth: 100,
      direction: 1,
      remainingTabs,
    }),
    1,
  );
  assert.equal(
    overlapIndex({
      draggedLeft: 220,
      draggedWidth: 100,
      direction: 1,
      remainingTabs,
    }),
    1,
  );
  assert.equal(
    overlapIndex({
      draggedLeft: 180,
      draggedWidth: 140,
      direction: 1,
      remainingTabs,
    }),
    2,
  );
});

test("initializes destination slots from endpoints and 60% overlap", () => {
  const remainingTabs = [
    { key: "a", left: 100, width: 100 },
    { key: "b", left: 200, width: 200 },
  ];
  assert.equal(
    initialTabIndexAtOverlap({
      draggedLeft: 0,
      draggedWidth: 100,
      direction: 1,
      remainingTabs,
    }),
    0,
  );
  assert.equal(
    initialTabIndexAtOverlap({
      draggedLeft: 400,
      draggedWidth: 100,
      direction: -1,
      remainingTabs,
    }),
    2,
  );
  assert.equal(
    initialTabIndexAtOverlap({
      draggedLeft: 141,
      draggedWidth: 100,
      direction: 1,
      remainingTabs,
    }),
    undefined,
  );
  assert.equal(
    initialTabIndexAtOverlap({
      draggedLeft: 140,
      draggedWidth: 100,
      direction: 1,
      remainingTabs,
    }),
    1,
  );
  assert.equal(
    initialTabIndexAtOverlap({
      draggedLeft: 220,
      draggedWidth: 120,
      direction: 1,
      remainingTabs,
    }),
    2,
  );
  assert.equal(
    initialTabIndexAtOverlap({
      draggedLeft: 0,
      draggedWidth: 100,
      direction: 0,
      remainingTabs: [],
    }),
    0,
  );
});

test("stays put without movement, an adjacent tab, or measured bounds", () => {
  assert.equal(overlapIndex({ draggedLeft: 200, direction: 0 }), 1);
  assert.equal(
    overlapIndex({
      orderedKeys: keys,
      draggedKey: "a",
      draggedLeft: -100,
      direction: -1,
    }),
    0,
  );
  assert.equal(
    overlapIndex({
      orderedKeys: keys,
      draggedKey: "d",
      draggedLeft: 400,
      direction: 1,
    }),
    3,
  );
  assert.equal(
    overlapIndex({
      draggedLeft: 200,
      direction: 1,
      remainingTabs: [],
    }),
    1,
  );
});
