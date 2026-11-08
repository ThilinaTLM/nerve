import assert from "node:assert/strict";
import { test } from "node:test";
import { navigateTree, type TreeRow } from "./git-tree-navigation.js";

const rows: TreeRow[] = [
  { id: "api", kind: "repository", expanded: true },
  { id: "api/main", kind: "branch", parent: "api" },
  { id: "api/feat", kind: "branch", parent: "api" },
  { id: "ui", kind: "repository", expanded: false },
];

test("up, down, home and end move between visible rows", () => {
  assert.deepEqual(navigateTree(rows, "api", "ArrowDown"), {
    type: "focus",
    id: "api/main",
  });
  assert.deepEqual(navigateTree(rows, "ui", "ArrowDown"), {
    type: "focus",
    id: "ui",
  });
  assert.deepEqual(navigateTree(rows, "api", "ArrowUp"), {
    type: "focus",
    id: "api",
  });
  assert.deepEqual(navigateTree(rows, "api/feat", "Home"), {
    type: "focus",
    id: "api",
  });
  assert.deepEqual(navigateTree(rows, "api", "End"), {
    type: "focus",
    id: "ui",
  });
});

test("right expands a repository or enters its first branch", () => {
  assert.deepEqual(navigateTree(rows, "ui", "ArrowRight"), {
    type: "expand",
    id: "ui",
  });
  assert.deepEqual(navigateTree(rows, "api", "ArrowRight"), {
    type: "focus",
    id: "api/main",
  });
  assert.equal(navigateTree(rows, "api/main", "ArrowRight"), undefined);
});

test("left collapses a repository or moves a branch to its parent", () => {
  assert.deepEqual(navigateTree(rows, "api", "ArrowLeft"), {
    type: "collapse",
    id: "api",
  });
  assert.equal(navigateTree(rows, "ui", "ArrowLeft"), undefined);
  assert.deepEqual(navigateTree(rows, "api/feat", "ArrowLeft"), {
    type: "focus",
    id: "api",
  });
});

test("enter and space select branches and toggle repositories", () => {
  assert.deepEqual(navigateTree(rows, "api/main", "Enter"), {
    type: "select",
    id: "api/main",
  });
  assert.deepEqual(navigateTree(rows, "api/main", " "), {
    type: "select",
    id: "api/main",
  });
  assert.deepEqual(navigateTree(rows, "ui", "Enter"), {
    type: "toggle",
    id: "ui",
  });
  assert.equal(navigateTree([], undefined, "ArrowDown"), undefined);
});
