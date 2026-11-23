import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applySelectionKey,
  clickSelection,
  panelSelectionKeyAction,
  pruneSelection,
  selectOnly,
  selectRange,
  toggleSelected,
} from "./panel-selection";

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
  assert.deepEqual(
    [...selectRange(visible, selectOnly("c"), "a").ids],
    ["a", "b", "c"],
  );
  assert.deepEqual(
    [...selectRange(visible, { ids: new Set() }, "b").ids],
    ["b"],
  );
});

test("prunes ids that disappeared", () => {
  const selection = selectRange(visible, selectOnly("a"), "c");
  assert.deepEqual(
    [...pruneSelection(selection, new Set(["a", "c"])).ids],
    ["a", "c"],
  );
  assert.equal(pruneSelection(selection, new Set(visible)), selection);
});

const mods = { shiftKey: false, ctrlKey: false, metaKey: false };

test("click gestures: plain selects, modifiers are consumed", () => {
  const start = selectOnly("a");
  const plain = clickSelection(start, visible, "c", mods);
  assert.equal(plain.consumed, false);
  assert.deepEqual([...plain.selection.ids], ["c"]);
  const ctrl = clickSelection(start, visible, "c", { ...mods, ctrlKey: true });
  assert.equal(ctrl.consumed, true);
  assert.deepEqual([...ctrl.selection.ids], ["a", "c"]);
  const shift = clickSelection(start, visible, "c", {
    ...mods,
    shiftKey: true,
  });
  assert.deepEqual([...shift.selection.ids], ["a", "b", "c"]);
});

test("keyboard: extend, select all, clear", () => {
  const key = (k: string, extra: object = {}) => ({
    key: k,
    altKey: false,
    ...mods,
    ...extra,
  });
  assert.deepEqual(
    panelSelectionKeyAction(key("ArrowDown", { shiftKey: true }), false),
    {
      type: "extend",
      direction: 1,
    },
  );
  assert.deepEqual(
    panelSelectionKeyAction(key("a", { metaKey: true }), false),
    {
      type: "select-all",
    },
  );
  assert.equal(panelSelectionKeyAction(key("Escape"), false), undefined);
  assert.deepEqual(panelSelectionKeyAction(key("Escape"), true), {
    type: "clear-selection",
  });

  const extended = applySelectionKey({ ids: new Set() }, visible, "b", {
    type: "extend",
    direction: 1,
  });
  assert.deepEqual([...extended.selection.ids], ["b", "c"]);
  assert.equal(extended.revealId, "c");
  assert.equal(
    applySelectionKey(selectOnly("d"), visible, "d", {
      type: "extend",
      direction: 1,
    }).revealId,
    undefined,
  );
  assert.deepEqual(
    [
      ...applySelectionKey(selectOnly("a"), visible, "a", {
        type: "select-all",
      }).selection.ids,
    ],
    visible,
  );
  assert.equal(
    applySelectionKey(selectOnly("a"), visible, "a", {
      type: "clear-selection",
    }).selection.ids.size,
    0,
  );
});
