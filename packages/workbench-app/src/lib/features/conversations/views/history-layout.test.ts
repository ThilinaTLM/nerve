import assert from "node:assert/strict";
import { test } from "node:test";
import {
  HISTORY_COLUMN_GAP,
  HISTORY_LABEL_MAX,
  HISTORY_ROW_GAP,
  layoutHistoryTree,
} from "./history-layout";

function layout(edges: Record<string, string[]>, root = "a") {
  return layoutHistoryTree({
    root,
    childrenOf: new Map(Object.entries(edges)),
  });
}

test("a single line stays in one vertical column", () => {
  const result = layout({ a: ["b"], b: ["c"], c: ["d"] });
  const xs = ["a", "b", "c", "d"].map((id) => result.nodes.get(id)!.x);
  assert.deepEqual([...new Set(xs)], [0]);
  assert.equal(result.nodes.get("d")!.y, 3 * HISTORY_ROW_GAP);
  assert.equal(result.columns, 1);
});

test("a fork splits children left and right under the parent", () => {
  const result = layout({ a: ["b", "c"], b: ["d"], c: ["e"] });
  const { nodes } = result;
  assert.ok(nodes.get("b")!.x < nodes.get("a")!.x);
  assert.ok(nodes.get("c")!.x > nodes.get("a")!.x);
  assert.equal(nodes.get("b")!.x, nodes.get("d")!.x);
  assert.equal(nodes.get("c")!.x, nodes.get("e")!.x);
  assert.equal(nodes.get("b")!.y, HISTORY_ROW_GAP);
  assert.equal(result.columns, 2);
});

test("nested forks never place two nodes on the same spot", () => {
  const result = layout({
    a: ["b", "c"],
    b: ["d", "e"],
    c: ["f", "g"],
    f: ["h", "i"],
    g: ["j"],
    j: ["k", "l"],
  });
  const spots = [...result.nodes.values()].map((node) => `${node.x}:${node.y}`);
  assert.equal(new Set(spots).size, spots.length);
  // Subtrees occupy disjoint x ranges below their fork.
  const x = (id: string) => result.nodes.get(id)!.x;
  assert.ok(
    Math.max(x("d"), x("e")) < Math.min(x("h"), x("i"), x("k"), x("l")),
  );
  assert.equal(result.columns, 6);
});

test("long chains lay out without recursion limits", () => {
  const edges: Record<string, string[]> = {};
  for (let i = 0; i < 20_000; i++) edges[`n${i}`] = [`n${i + 1}`];
  const result = layout(edges, "n0");
  assert.equal(result.nodes.size, 20_001);
  assert.equal(result.nodes.get("n20000")!.row, 20_000);
});

test("label width stops before the next node on the same row", () => {
  const result = layout({ a: ["b", "c"], b: ["d"], c: ["e"] });
  const { nodes } = result;
  assert.equal(nodes.get("c")!.labelWidth, HISTORY_LABEL_MAX);
  const gap = nodes.get("c")!.x - nodes.get("b")!.x;
  assert.ok(gap <= HISTORY_COLUMN_GAP);
  assert.ok(nodes.get("b")!.labelWidth < gap);
  assert.ok(nodes.get("b")!.labelWidth <= HISTORY_LABEL_MAX);
});
