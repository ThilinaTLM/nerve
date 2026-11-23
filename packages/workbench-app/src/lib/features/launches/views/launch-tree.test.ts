import assert from "node:assert/strict";
import test from "node:test";
import {
  buildLaunchTree,
  flattenLaunchTree,
  launchStepTarget,
  planLaunchMoves,
} from "./launch-tree.js";

const folder = (id: string, parentFolderId: string | null, order: number) =>
  ({ id, label: id, parentFolderId, order }) as never;
const def = (id: string, parentFolderId: string | null, order: number) =>
  ({
    key: id,
    definition: { id, parentFolderId, order, command: id },
    runs: [],
    activeRuns: id === "d2" ? [{}, {}] : [],
  }) as never;

// root: fA(0){ d1(0), fB(1) }, d2(1), d3(2)
const tree = buildLaunchTree(
  [folder("fB", "fA", 1), folder("fA", null, 0)],
  [def("d3", null, 2), def("d1", "fA", 0), def("d2", "fA", 5)],
);

test("builds mixed ordered siblings and counts descendant activity", () => {
  assert.deepEqual(
    tree.map((n) => n.id),
    ["fA", "d3"],
  );
  const a = tree[0]!;
  assert.equal(a.kind === "folder" && a.activeCount, 1);
  assert.deepEqual(a.kind === "folder" && a.children.map((n) => n.id), [
    "d1",
    "fB",
    "d2",
  ]);
});

const d = (id: string) => ({ kind: "definition", id }) as const;
const f = (id: string) => ({ kind: "folder", id }) as const;

test("plans before/after anchors and detects no-ops", () => {
  assert.deepEqual(
    planLaunchMoves(tree, [d("d3")], { ref: f("fA"), zone: "before" }),
    {
      destinationFolderId: null,
      beforeSibling: f("fA"),
      entries: [d("d3")],
      noop: false,
    },
  );
  assert.equal(
    planLaunchMoves(tree, [d("d3")], { ref: f("fA"), zone: "after" })?.noop,
    true,
  );
  // Before the first child of an open folder: the slot below its header.
  const first = planLaunchMoves(tree, [d("d3")], {
    ref: d("d1"),
    zone: "before",
  });
  assert.equal(first?.destinationFolderId, "fA");
  assert.deepEqual(first?.beforeSibling, d("d1"));
});

test("inside appends and the root drop targets the top level", () => {
  const inside = planLaunchMoves(tree, [d("d3")], {
    ref: f("fA"),
    zone: "inside",
  });
  assert.equal(inside?.destinationFolderId, "fA");
  assert.equal(inside?.beforeSibling, null);
  assert.equal(
    planLaunchMoves(tree, [d("d3")], { zone: "inside" })?.noop,
    true,
  );
  assert.equal(
    planLaunchMoves(tree, [d("d1")], { zone: "inside" })?.destinationFolderId,
    null,
  );
  assert.equal(
    planLaunchMoves(tree, [d("d3")], { ref: d("d1"), zone: "inside" }),
    undefined,
  );
});

test("rejects invalid placements", () => {
  assert.equal(
    planLaunchMoves(tree, [f("fA")], { ref: f("fB"), zone: "inside" }),
    undefined,
  );
  assert.equal(
    planLaunchMoves(tree, [f("fA")], { ref: d("d1"), zone: "after" }),
    undefined,
  );
  assert.equal(
    planLaunchMoves(tree, [d("d1")], { ref: d("d1"), zone: "after" }),
    undefined,
  );
  assert.equal(planLaunchMoves(tree, [], { zone: "inside" }), undefined);
});

test("moves several entries in tree order before one anchor", () => {
  const plan = planLaunchMoves(tree, [d("d3"), d("d1")], {
    ref: d("d2"),
    zone: "before",
  });
  assert.deepEqual(plan, {
    destinationFolderId: "fA",
    beforeSibling: d("d2"),
    entries: [d("d1"), d("d3")],
    noop: false,
  });
  // Landing next to each other where they already are changes nothing.
  assert.equal(
    planLaunchMoves(tree, [d("d1"), f("fB")], { ref: d("d2"), zone: "before" })
      ?.noop,
    true,
  );
});

test("a moved folder carries its selected descendants", () => {
  const plan = planLaunchMoves(tree, [f("fA"), d("d1")], {
    zone: "inside",
  });
  assert.deepEqual(plan?.entries, [f("fA")]);
});

test("step targets are the neighbouring sibling", () => {
  assert.deepEqual(launchStepTarget(tree, d("d1"), "down"), {
    ref: f("fB"),
    zone: "after",
  });
  assert.deepEqual(launchStepTarget(tree, d("d2"), "up"), {
    ref: f("fB"),
    zone: "before",
  });
  assert.equal(launchStepTarget(tree, f("fA"), "up"), undefined);
  assert.equal(launchStepTarget(tree, d("d3"), "down"), undefined);
});

test("flattens in tree order", () => {
  assert.deepEqual(
    flattenLaunchTree(tree).map((node) => node.id),
    ["fA", "d1", "fB", "d2", "d3"],
  );
});

test("folder badge counts distinct active definitions, not runs", () => {
  const a = tree[0]!;
  // d2 has two active runs but is one active configuration.
  assert.equal(a.kind === "folder" && a.activeCount, 1);
});
