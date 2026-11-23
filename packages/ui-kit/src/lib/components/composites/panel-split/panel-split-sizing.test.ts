import assert from "node:assert/strict";
import test from "node:test";
import {
  emptyPanelSplitLayout,
  isDividerDraggable,
  panelSplitHeights,
  sizeFor,
  withCollapsed,
  withSize,
  type PanelSplitArea,
  type PanelSplitLayout,
} from "./panel-split-sizing.js";

const HEADER_PX = 32;
const MIN_CHANGES_PX = 96;
// The Git panel's three areas.
const list: PanelSplitArea = {
  id: "list",
  collapsible: false,
  minPx: 56,
  fitContent: true,
  autoMaxShare: 0.5,
};
const branch: PanelSplitArea = {
  id: "branch",
  minPx: HEADER_PX + 32,
  headerPx: HEADER_PX,
  autoMaxShare: 0.45,
};
const changes: PanelSplitArea = {
  id: "changes",
  minPx: MIN_CHANGES_PX,
  headerPx: HEADER_PX,
};
const all = [list, branch, changes];

const open: PanelSplitLayout = emptyPanelSplitLayout();
const contentPx = { list: 200, branch: 120 };
const heights = (
  overrides: {
    areas?: PanelSplitArea[];
    layout?: PanelSplitLayout;
    totalPx?: number;
    contentPx?: Record<string, number>;
  } = {},
) =>
  panelSplitHeights({
    areas: all,
    layout: open,
    totalPx: 1000,
    contentPx,
    ...overrides,
  });
const collapsed = (...ids: string[]): PanelSplitLayout => ({
  collapsed: Object.fromEntries(ids.map((id) => [id, true])),
  sizes: {},
});
const sized = (sizes: Record<string, number>): PanelSplitLayout => ({
  collapsed: {},
  sizes,
});
const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);

void test("list and branch fit their content; the last area takes the rest", () => {
  assert.deepEqual(heights(), [200, 120, 680]);
});

void test("automatic areas are capped; manual sizes are exact, larger than content too", () => {
  assert.equal(heights({ contentPx: { list: 900 } })[0], 500);
  assert.equal(
    heights({ contentPx: { list: 900 }, layout: sized({ list: 0.3 }) })[0],
    300,
  );
  assert.equal(heights({ layout: sized({ list: 0.4 }) })[0], 400);
  assert.equal(heights({ layout: sized({ branch: 0.3 }) })[1], 300);
  assert.equal(
    heights({
      contentPx: { branch: 800 },
      layout: sized({ branch: 0.2 }),
    })[1],
    200,
  );
});

void test("collapsed areas are exactly their header; the lowest open area fills", () => {
  assert.deepEqual(heights({ layout: collapsed("changes") }), [
    200,
    1000 - 200 - HEADER_PX,
    HEADER_PX,
  ]);
  assert.deepEqual(heights({ layout: collapsed("branch", "changes") }), [
    1000 - 2 * HEADER_PX,
    HEADER_PX,
    HEADER_PX,
  ]);
  assert.deepEqual(
    heights({ areas: [branch, changes], layout: collapsed("changes") }),
    [1000 - HEADER_PX, HEADER_PX],
  );
  assert.equal(
    sum(
      heights({
        layout: { collapsed: { changes: true }, sizes: { branch: 0.2 } },
      }),
    ),
    1000,
  );
});

void test("a higher fill priority wins over position", () => {
  const top = { ...list, fill: 10 };
  assert.deepEqual(heights({ areas: [top, branch, changes] }), [784, 120, 96]);
});

void test("heights fill the panel whenever an area is open", () => {
  for (const branchOff of [true, false])
    for (const changesOff of [true, false])
      for (const withList of [true, false]) {
        if (!withList && branchOff && changesOff) continue;
        const layout = collapsed(
          ...(branchOff ? ["branch"] : []),
          ...(changesOff ? ["changes"] : []),
        );
        const areas = withList ? all : [branch, changes];
        assert.equal(sum(heights({ areas, layout })), 1000);
      }
});

void test("the filling area keeps its minimum: the upper areas give first", () => {
  const result = heights({
    totalPx: 400,
    layout: sized({ list: 0.9, branch: 0.9 }),
  });
  assert.equal(result[2], MIN_CHANGES_PX);
  assert.equal(sum(result), 400);
});

void test("heights never exceed the total, even when it is tiny", () => {
  for (const totalPx of [0, 40, 90, 150]) {
    const result = heights({ totalPx });
    assert.equal(Math.round(sum(result)), totalPx);
    assert.ok(result.every((px) => px >= 0));
  }
});

void test("dividers resize an open area above them, never the filling one", () => {
  const drag = (index: number, layout = open, areas = all) =>
    isDividerDraggable(areas, layout, index);
  assert.equal(drag(0), true);
  assert.equal(drag(0, collapsed("branch", "changes")), false);
  assert.equal(drag(1), true);
  assert.equal(drag(1, collapsed("branch")), false);
  assert.equal(drag(1, collapsed("changes")), false);
  assert.equal(drag(0, open, [branch, changes]), true);
  assert.equal(sizeFor(250, 1000), 0.25);
  assert.equal(sizeFor(10, 1000), 0.05);
});

void test("layout updates are immutable and plain data", () => {
  const next = withSize(withCollapsed(open, "branch", true), "list", 0.3);
  assert.deepEqual(next, { collapsed: { branch: true }, sizes: { list: 0.3 } });
  assert.deepEqual(open, { collapsed: {}, sizes: {} });
  assert.deepEqual(withSize(next, "list", null).sizes, {});
  assert.deepEqual(JSON.parse(JSON.stringify(next)), next);
});
