import assert from "node:assert/strict";
import { test } from "node:test";
import {
  adjacentPanelTreeRowId,
  buildPanelTree,
  expandedPanelTreeGroupIds,
  firstPanelTreeChildId,
  panelTreeGroupIds,
  parentPanelTreeRowId,
  visiblePanelTreeRows,
} from "./panel-tree.js";

type Entry = { key: string; path: string[] };

const tree = (entries: Entry[]) =>
  buildPanelTree(entries, {
    getPath: (entry) => entry.path,
    getKey: (entry) => entry.key,
  });

test("builds a directory-first alphabetical filesystem tree", () => {
  const nodes = tree([
    { key: "z", path: ["z.txt"] },
    { key: "b", path: ["src", "b.ts"] },
    { key: "a", path: ["src", "a.ts"] },
    { key: "r", path: ["README.md"] },
  ]);

  assert.deepEqual(
    nodes.map((node) => [node.kind, node.label]),
    [
      ["group", "src"],
      ["item", "README.md"],
      ["item", "z.txt"],
    ],
  );
  const src = nodes[0];
  assert.equal(src?.kind, "group");
  if (src?.kind === "group")
    assert.deepEqual(
      src.children.map((node) => node.label),
      ["a.ts", "b.ts"],
    );
});

test("compacts unbranched directories and stops at branches", () => {
  const compact = tree([
    { key: "a", path: ["packages", "ui-kit", "src", "a.ts"] },
    { key: "b", path: ["packages", "ui-kit", "src", "b.ts"] },
  ]);
  assert.equal(compact[0]?.label, "packages/ui-kit/src");

  const branched = tree([
    { key: "a", path: ["packages", "app", "a.ts"] },
    { key: "b", path: ["packages", "ui", "b.ts"] },
  ]);
  assert.equal(branched[0]?.label, "packages");
  assert.equal(branched[0]?.kind, "group");
  if (branched[0]?.kind === "group")
    assert.deepEqual(
      branched[0].children.map((node) => node.label),
      ["app", "ui"],
    );
});

test("does not compact through a directory that also contains files", () => {
  const nodes = tree([
    { key: "local", path: ["src", "index.ts"] },
    { key: "nested", path: ["src", "lib", "nested.ts"] },
  ]);
  assert.equal(nodes[0]?.label, "src");
  assert.equal(nodes[0]?.kind, "group");
  if (nodes[0]?.kind === "group")
    assert.deepEqual(
      nodes[0].children.map((node) => [node.kind, node.label]),
      [
        ["group", "lib"],
        ["item", "index.ts"],
      ],
    );
});

test("uses collision-safe full segment arrays for directory ids", () => {
  const nodes = tree([
    { key: "nested", path: ["a", "b", "nested.ts"] },
    { key: "slash", path: ["a/b", "slash.ts"] },
  ]);
  const ids = [...panelTreeGroupIds(nodes)];
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.includes('group:["a","b"]'));
  assert.ok(ids.includes('group:["a/b"]'));
});

test("projects expanded rows with compact depth and ARIA sibling metadata", () => {
  const nodes = tree([
    { key: "a", path: ["packages", "ui", "a.ts"] },
    { key: "b", path: ["packages", "web", "b.ts"] },
    { key: "root", path: ["README.md"] },
  ]);
  const groupIds = panelTreeGroupIds(nodes);
  const expanded = expandedPanelTreeGroupIds(groupIds, new Set());
  assert.deepEqual(expanded, groupIds);
  const rows = visiblePanelTreeRows(nodes, expanded);

  assert.deepEqual(
    rows.map((row) => [row.node.label, row.depth, row.posInSet, row.setSize]),
    [
      ["packages", 0, 1, 2],
      ["ui", 1, 1, 2],
      ["a.ts", 2, 1, 1],
      ["web", 1, 2, 2],
      ["b.ts", 2, 1, 1],
      ["README.md", 0, 2, 2],
    ],
  );

  const rootId = rows[0]!.node.id;
  const firstChildId = rows[1]!.node.id;
  assert.equal(firstPanelTreeChildId(rows, rootId), firstChildId);
  assert.equal(parentPanelTreeRowId(rows, firstChildId), rootId);
});

test("hides collapsed descendants and resolves keyboard destinations", () => {
  const nodes = tree([
    { key: "a", path: ["src", "a.ts"] },
    { key: "b", path: ["src", "b.ts"] },
    { key: "root", path: ["README.md"] },
  ]);
  const collapsedRows = visiblePanelTreeRows(nodes, new Set());
  assert.deepEqual(
    collapsedRows.map((row) => row.node.label),
    ["src", "README.md"],
  );

  const firstId = collapsedRows[0]!.node.id;
  const lastId = collapsedRows[1]!.node.id;
  assert.equal(adjacentPanelTreeRowId(collapsedRows, firstId, "next"), lastId);
  assert.equal(
    adjacentPanelTreeRowId(collapsedRows, lastId, "previous"),
    firstId,
  );
  assert.equal(adjacentPanelTreeRowId(collapsedRows, firstId, "last"), lastId);
  assert.equal(adjacentPanelTreeRowId(collapsedRows, lastId, "first"), firstId);
});
