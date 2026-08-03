import assert from "node:assert/strict";
import { test } from "node:test";
import { SvelteSet } from "svelte/reactivity";
import type { FileExplorerProjectState } from "./file-explorer-state.svelte";
import {
  buildFileExplorerTree,
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
