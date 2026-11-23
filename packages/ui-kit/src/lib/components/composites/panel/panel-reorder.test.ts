import assert from "node:assert/strict";
import { test } from "node:test";
import {
  canContainPanelItems,
  indexPanelReorderNodes,
  normalizePanelReorderDrop,
  panelReorderKey,
  panelReorderKeyDrop,
  panelReorderZone,
} from "./panel-reorder.js";
import { buildPanelItemTree } from "./panel-tree.js";

type Item = { key: string; parent?: string; folder?: boolean };
const items: Item[] = [
  { key: "a" },
  { key: "f", folder: true },
  { key: "f1", parent: "f" },
  { key: "f2", parent: "f", folder: true },
  { key: "b" },
  { key: "g", folder: true },
];
const nodes = buildPanelItemTree(items, {
  getKey: (item) => item.key,
  getLabel: (item) => item.key,
  getParentKey: (item) => item.parent,
  isExpandable: (item) => item.folder === true,
});
const index = indexPanelReorderNodes(nodes);
const none = new Set<string>();
const drop = (id: string, key: "up" | "down" | "in" | "out", moving = none) => {
  const result = panelReorderKeyDrop(index, id, key, moving);
  return result && `${result.node.id}:${result.zone}`;
};

test("zones: containers use quarter/half/quarter, leaves halves", () => {
  assert.equal(panelReorderZone(0.1, true), "before");
  assert.equal(panelReorderZone(0.5, true), "inside");
  assert.equal(panelReorderZone(0.9, true), "after");
  assert.equal(panelReorderZone(0.4, false), "before");
  assert.equal(panelReorderZone(0.6, false), "after");
});

test("empty expandable items contain, plain leaves do not", () => {
  assert.equal(canContainPanelItems(index.get("item:g")!.node), true);
  assert.equal(canContainPanelItems(index.get("item:a")!.node), false);
});

test("after an expanded container means before its first child", () => {
  const folder = index.get("item:f")!.node;
  const open = normalizePanelReorderDrop(folder, "after", true);
  assert.equal(open.node.id, "item:f1");
  assert.equal(open.zone, "before");
  assert.equal(normalizePanelReorderDrop(folder, "after", false).node, folder);
  const empty = index.get("item:g")!.node;
  assert.equal(normalizePanelReorderDrop(empty, "after", true).node, empty);
  assert.equal(normalizePanelReorderDrop(folder, "inside", true).node, folder);
});

test("keyboard moves resolve targets among siblings", () => {
  assert.equal(drop("item:b", "up"), "item:f:before");
  assert.equal(drop("item:a", "up"), undefined);
  assert.equal(drop("item:b", "down"), "item:g:after");
  assert.equal(drop("item:g", "down"), undefined);
  assert.equal(drop("item:b", "in"), "item:f:inside");
  assert.equal(drop("item:f", "in"), undefined);
  assert.equal(drop("item:f1", "out"), "item:f:after");
  assert.equal(drop("item:a", "out"), undefined);
});

test("keyboard moves skip rows that move along", () => {
  assert.equal(drop("item:g", "up", new Set(["item:b"])), "item:f:before");
  assert.equal(drop("item:a", "down", new Set(["item:f"])), "item:b:after");
  assert.equal(drop("item:f1", "out", new Set(["item:f"])), undefined);
});

test("maps Alt+Arrow only", () => {
  const event = (key: string, extra: object = {}) => ({
    key,
    altKey: true,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    ...extra,
  });
  assert.equal(panelReorderKey(event("ArrowUp")), "up");
  assert.equal(panelReorderKey(event("ArrowLeft")), "out");
  assert.equal(panelReorderKey(event("ArrowUp", { altKey: false })), undefined);
  assert.equal(
    panelReorderKey(event("ArrowUp", { shiftKey: true })),
    undefined,
  );
  assert.equal(panelReorderKey(event("a")), undefined);
});
