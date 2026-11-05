import assert from "node:assert/strict";
import { test } from "node:test";
import { SvelteSet } from "svelte/reactivity";
import type { FileExplorerProjectState } from "./file-explorer-state.svelte";
import {
  buildFileExplorerTree,
  buildFileExplorerTreeView,
  fileExplorerEntryNodeId,
} from "./file-explorer-tree";

function project(): FileExplorerProjectState {
  return {
    projectId: "project",
    expandedIds: new SvelteSet<string>(),
    directories: {
      "": {
        path: "",
        entries: [
          { name: ".git", path: ".git", kind: "directory", symlink: false },
          {
            name: "README.md",
            path: "README.md",
            kind: "file",
            symlink: false,
          },
        ],
        pagesLoaded: 1,
        loading: false,
        refreshing: false,
        generation: 0,
        stale: false,
      },
    },
  };
}

test("projects unloaded directories as expandable tree items", () => {
  const state = project();
  const nodes = buildFileExplorerTree(state);
  assert.equal(nodes[0]?.id, fileExplorerEntryNodeId("project", ".git"));
  assert.equal(nodes[0]?.kind, "item");
  assert.equal(nodes[0]?.expandable, true);
  assert.deepEqual(nodes[0]?.children, []);
});

test("projects loaded descendants and pagination rows", () => {
  const state = project();
  state.directories[".git"] = {
    path: ".git",
    entries: [
      { name: "config", path: ".git/config", kind: "file", symlink: false },
    ],
    nextCursor: "next",
    pagesLoaded: 1,
    loading: false,
    refreshing: false,
    generation: 0,
    stale: false,
  };
  const folder = buildFileExplorerTree(state)[0];
  assert.deepEqual(
    folder?.children.map((node) => node.label),
    ["config", "Load more…"],
  );
});

test("keeps symlink directories visible but non-expandable", () => {
  const state = project();
  state.directories[""].entries.unshift({
    name: "linked",
    path: "linked",
    kind: "directory",
    symlink: true,
  });
  const linked = buildFileExplorerTree(state)[0];
  assert.equal(linked?.label, "linked");
  assert.equal(linked?.kind, "item");
  if (linked?.kind === "item") assert.equal(linked.expandable, false);
});

function nestedProject(): FileExplorerProjectState {
  const state = project();
  state.directories[""].entries.push({
    name: "node_modules",
    path: "node_modules",
    kind: "directory",
    symlink: false,
    ignored: true,
  });
  state.directories[".git"] = {
    ...state.directories[""],
    path: ".git",
    entries: [],
  };
  state.directories["node_modules"] = {
    ...state.directories[""],
    path: "node_modules",
    entries: [
      {
        name: "readme.txt",
        path: "node_modules/readme.txt",
        kind: "file",
        symlink: false,
      },
    ],
  };
  return state;
}

test("hides ignored entries and dotfiles on request", () => {
  const state = nestedProject();
  const labels = (options: Parameters<typeof buildFileExplorerTree>[1]) =>
    buildFileExplorerTree(state, options).map((node) => node.label);
  assert.deepEqual(labels({}), [".git", "README.md", "node_modules"]);
  assert.deepEqual(labels({ hideDotfiles: true }), [
    "README.md",
    "node_modules",
  ]);
  assert.deepEqual(labels({ hideIgnored: true }), [".git", "README.md"]);
});

test("name filter keeps ancestors of matches and forces them open", () => {
  const state = nestedProject();
  const { nodes, filterExpandedIds } = buildFileExplorerTreeView(state, {
    filter: "READ",
  });
  assert.deepEqual(
    nodes.map((node) => node.label),
    ["README.md", "node_modules"],
  );
  assert.deepEqual(
    nodes[1]?.children.map((node) => node.label),
    ["readme.txt"],
  );
  assert.ok(
    filterExpandedIds.has(fileExplorerEntryNodeId("project", "node_modules")),
  );
});

test("adds the inline create row first in its directory", () => {
  const { nodes } = buildFileExplorerTreeView(nestedProject(), {
    creating: { parentPath: "", kind: "file" },
  });
  const first = nodes[0];
  assert.equal(first?.kind === "item" && first.value.type, "editor");
});
