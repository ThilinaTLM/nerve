import assert from "node:assert/strict";
import test from "node:test";
import {
  capFor,
  draggable,
  HEADER_PX,
  MIN_CHANGES_PX,
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
  listCap: null,
  branchCap: null,
};
const sum = (h: { list: number; branch: number; changes: number }) =>
  h.list + h.branch + h.changes;

void test("list and branch fit their content; Changes takes the rest", () => {
  const heights = splitHeights(base);
  assert.deepEqual(heights, { list: 200, branch: 120, changes: 680 });
});

void test("content larger than the cap is capped (automatic or user)", () => {
  assert.equal(splitHeights({ ...base, listContentPx: 900 }).list, 500);
  assert.equal(
    splitHeights({ ...base, listContentPx: 900, listCap: 0.3 }).list,
    300,
  );
  assert.equal(
    splitHeights({ ...base, branchContentPx: 800, branchCap: 0.2 }).branch,
    200,
  );
});

void test("collapsed sections are headers; collapsed Changes gives the rest to the list", () => {
  const heights = splitHeights({
    ...base,
    branchOpen: false,
    changesOpen: false,
  });
  assert.deepEqual(heights, {
    list: 1000 - 2 * HEADER_PX,
    branch: HEADER_PX,
    changes: HEADER_PX,
  });
});

void test("without a list a collapsed Changes gives the rest to the branch section", () => {
  const heights = splitHeights({ ...base, hasList: false, changesOpen: false });
  assert.deepEqual(heights, {
    list: 0,
    branch: 1000 - HEADER_PX,
    changes: HEADER_PX,
  });
});

void test("Changes keeps its minimum: the list gives first, then the branch", () => {
  const heights = splitHeights({
    ...base,
    totalPx: 400,
    listContentPx: 300,
    branchContentPx: 300,
    listCap: 0.9,
    branchCap: 0.9,
  });
  assert.equal(heights.changes, MIN_CHANGES_PX);
  assert.equal(sum(heights), 400);
});

void test("heights always add up to the total, even when it is tiny", () => {
  for (const totalPx of [0, 40, 90, 150]) {
    const heights = splitHeights({ ...base, totalPx });
    assert.equal(Math.round(sum(heights)), totalPx);
    assert.ok(heights.list >= 0 && heights.branch >= 0 && heights.changes >= 0);
  }
});

void test("dividers drag only where the area above is fit-sized", () => {
  assert.equal(draggable("list", base), true);
  assert.equal(draggable("list", { ...base, changesOpen: false }), false);
  assert.equal(draggable("branch", { ...base, branchOpen: false }), false);
  assert.equal(
    draggable("branch", { ...base, hasList: false, changesOpen: false }),
    false,
  );
  assert.equal(capFor(250, 1000), 0.25);
  assert.equal(capFor(10, 1000), 0.05);
});
