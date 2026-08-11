import assert from "node:assert/strict";
import { test } from "node:test";
import type { GitFileChange } from "@nervekit/contracts";
import { buildPanelTree } from "../panel/panel-tree.js";
import {
  gitChangeTreeFolderKey,
  gitExpandedGroupIds,
  gitFilesInScope,
  gitPathspecs,
} from "./git-panel-controller.js";

function change(
  path: string,
  options: Partial<GitFileChange> = {},
): GitFileChange {
  return {
    path,
    index: " ",
    worktree: "M",
    staged: false,
    untracked: false,
    ...options,
  };
}

test("selects staged and unstaged changes independently", () => {
  const files = [
    change("staged.ts", { index: "M", worktree: " ", staged: true }),
    change("unstaged.ts"),
    change("both.ts", { index: "M", staged: true }),
  ];
  assert.deepEqual(
    gitFilesInScope(files, "staged").map((file) => file.path),
    ["staged.ts", "both.ts"],
  );
  assert.deepEqual(
    gitFilesInScope(files, "unstaged").map((file) => file.path),
    ["unstaged.ts", "both.ts"],
  );
});

test("matches directory scopes at segment boundaries", () => {
  const files = [
    change("src/a.ts"),
    change("src/nested/b.ts"),
    change("src2/c.ts"),
  ];
  assert.deepEqual(
    gitFilesInScope(files, "unstaged", "src").map((file) => file.path),
    ["src/a.ts", "src/nested/b.ts"],
  );
});

test("keeps folder collapse identity separate by change area", () => {
  assert.notEqual(
    gitChangeTreeFolderKey("staged", ["src"]),
    gitChangeTreeFolderKey("unstaged", ["src"]),
  );
});

test("expands new folders and honors only current persisted collapse keys", () => {
  const nodes = buildPanelTree([change("src/nested/a.ts")], {
    getPath: (file) => file.path.split("/"),
    getKey: (file) => file.path,
  });
  const expanded = gitExpandedGroupIds(nodes, "unstaged", new Set());
  assert.deepEqual([...expanded], ['group:["src","nested"]']);

  assert.deepEqual(
    [
      ...gitExpandedGroupIds(
        nodes,
        "unstaged",
        new Set([
          gitChangeTreeFolderKey("unstaged", ["src", "nested"]),
          gitChangeTreeFolderKey("unstaged", ["stale"]),
          gitChangeTreeFolderKey("staged", ["src", "nested"]),
        ]),
      ),
    ],
    [],
  );
});

test("deduplicates current and previous rename pathspecs", () => {
  assert.deepEqual(
    gitPathspecs([
      change("new/name.ts", { renamedFrom: "old/name.ts" }),
      change("new/name.ts", { renamedFrom: "old/name.ts" }),
    ]),
    ["new/name.ts", "old/name.ts"],
  );
});
