import assert from "node:assert/strict";
import test from "node:test";
import {
  buildLaunchTree,
  describeLaunchDrop,
  planLaunchMove,
  planLaunchStep,
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

test("plans before/after anchors and detects no-ops", () => {
  const d3 = { kind: "definition", id: "d3" } as const;
  const before = planLaunchMove(tree, d3, {
    ref: { kind: "folder", id: "fA" },
    zone: "before",
  });
  assert.deepEqual(before, {
    destinationFolderId: null,
    beforeSibling: { kind: "folder", id: "fA" },
    noop: false,
  });
  assert.equal(
    planLaunchMove(tree, d3, {
      ref: { kind: "folder", id: "fA" },
      zone: "after",
    })?.noop,
    true,
  );
  const open = planLaunchMove(tree, d3, {
    ref: { kind: "folder", id: "fA" },
    zone: "after",
    expanded: true,
  });
  assert.deepEqual(open?.beforeSibling, { kind: "definition", id: "d1" });
  assert.equal(open?.destinationFolderId, "fA");
});

test("rejects moving a folder into its own subtree", () => {
  assert.equal(
    planLaunchMove(
      tree,
      { kind: "folder", id: "fA" },
      {
        ref: { kind: "folder", id: "fB" },
        zone: "inside",
      },
    ),
    undefined,
  );
  assert.equal(
    planLaunchMove(tree, { kind: "definition", id: "d1" }, { zone: "root" })
      ?.beforeSibling,
    null,
  );
});

test("steps move one slot within the parent", () => {
  assert.deepEqual(
    planLaunchStep(tree, { kind: "definition", id: "d1" }, "down"),
    {
      destinationFolderId: "fA",
      beforeSibling: { kind: "definition", id: "d2" },
      noop: false,
    },
  );
  assert.equal(
    planLaunchStep(tree, { kind: "folder", id: "fA" }, "up"),
    undefined,
  );
});

test("folder badge counts distinct active definitions, not runs", () => {
  const a = tree[0]!;
  // d2 has two active runs but is one active configuration.
  assert.equal(a.kind === "folder" && a.activeCount, 1);
});

test("drop preview names the full destination path", () => {
  const dup = buildLaunchTree(
    [
      folder("p1", null, 0),
      folder("p2", null, 1),
      { id: "s1", label: "Staging", parentFolderId: "p1", order: 0 } as never,
      { id: "s2", label: "Staging", parentFolderId: "p2", order: 0 } as never,
    ],
    [],
  );
  const text = (id: string) =>
    describeLaunchDrop(dup, {
      destinationFolderId: id,
      beforeSibling: null,
      noop: false,
    });
  assert.equal(text("s1"), "at the end of “p1 / Staging”");
  assert.equal(text("s2"), "at the end of “p2 / Staging”");
});
