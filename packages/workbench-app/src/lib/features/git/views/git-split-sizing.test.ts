import assert from "node:assert/strict";
import test from "node:test";
import {
  draggable,
  HEADER_PX,
  MIN_CHANGES_PX,
  sizeFor,
  splitHeights,
  type SplitInput,
} from "./git-split-sizing.js";

const base: SplitInput = {
  totalPx: 1000,
  hasList: true,
  listContentPx: 200,
  branchContentPx: 120,
  branchOpen: true,
  changesOpen: true,
  listSize: null,
  branchSize: null,
};
const sum = (h: { list: number; branch: number; changes: number }) =>
  h.list + h.branch + h.changes;

void test("list and branch fit their content; Changes takes the rest", () => {
  const heights = splitHeights(base);
  assert.deepEqual(heights, { list: 200, branch: 120, changes: 680 });
});

void test("automatic areas are capped; manual sizes are exact, larger than content too", () => {
  assert.equal(splitHeights({ ...base, listContentPx: 900 }).list, 500);
  assert.equal(
    splitHeights({ ...base, listContentPx: 900, listSize: 0.3 }).list,
    300,
  );
  assert.equal(splitHeights({ ...base, listSize: 0.4 }).list, 400);
  assert.equal(splitHeights({ ...base, branchSize: 0.3 }).branch, 300);
  assert.equal(
    splitHeights({ ...base, branchContentPx: 800, branchSize: 0.2 }).branch,
    200,
  );
});

void test("collapsed sections are exactly their header; the lowest open area fills", () => {
  // Changes collapsed: the branch section fills.
  assert.deepEqual(splitHeights({ ...base, changesOpen: false }), {
    list: 200,
    branch: 1000 - 200 - HEADER_PX,
    changes: HEADER_PX,
  });
  // Both collapsed: the list fills, headers stack at the bottom.
  assert.deepEqual(
    splitHeights({ ...base, branchOpen: false, changesOpen: false }),
    { list: 1000 - 2 * HEADER_PX, branch: HEADER_PX, changes: HEADER_PX },
  );
  // No list, Changes collapsed: the branch section fills.
  assert.deepEqual(
    splitHeights({ ...base, hasList: false, changesOpen: false }),
    { list: 0, branch: 1000 - HEADER_PX, changes: HEADER_PX },
  );
  // A manual size of the filling area does not leave a gap.
  assert.equal(
    sum(splitHeights({ ...base, changesOpen: false, branchSize: 0.2 })),
    1000,
  );
});

void test("heights fill the panel whenever an area is open", () => {
  for (const branchOpen of [true, false])
    for (const changesOpen of [true, false])
      for (const hasList of [true, false]) {
        if (!hasList && !branchOpen && !changesOpen) continue;
        const heights = splitHeights({
          ...base,
          hasList,
          branchOpen,
          changesOpen,
        });
        assert.equal(sum(heights), 1000);
      }
});

void test("Changes keeps its minimum: the list gives first, then the branch", () => {
  const heights = splitHeights({
    ...base,
    totalPx: 400,
    listSize: 0.9,
    branchSize: 0.9,
  });
  assert.equal(heights.changes, MIN_CHANGES_PX);
  assert.equal(sum(heights), 400);
});

void test("heights never exceed the total, even when it is tiny", () => {
  for (const totalPx of [0, 40, 90, 150]) {
    const heights = splitHeights({ ...base, totalPx });
    assert.equal(Math.round(sum(heights)), totalPx);
    assert.ok(heights.list >= 0 && heights.branch >= 0 && heights.changes >= 0);
  }
});

void test("dividers resize a fixed open area above them, never the filling one", () => {
  assert.equal(draggable("list", base), true);
  assert.equal(draggable("list", { ...base, hasList: false }), false);
  assert.equal(
    draggable("list", { ...base, branchOpen: false, changesOpen: false }),
    false,
  );
  assert.equal(draggable("branch", base), true);
  assert.equal(draggable("branch", { ...base, branchOpen: false }), false);
  assert.equal(draggable("branch", { ...base, changesOpen: false }), false);
  assert.equal(sizeFor(250, 1000), 0.25);
  assert.equal(sizeFor(10, 1000), 0.05);
});
