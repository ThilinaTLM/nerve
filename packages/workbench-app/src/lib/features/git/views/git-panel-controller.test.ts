import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  GitBranchSummary,
  GitFileChange,
  GithubPrHeadsResponse,
} from "@nervekit/contracts/git";
import { buildPanelTree } from "$lib/presentation/panels/panel-tree";
import {
  gitChangeTreeFolderKey,
  gitExpandedGroupIds,
  gitFilesInScope,
  gitPathspecs,
  groupBranchesForDialog,
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

function branch(
  name: string,
  options: Partial<GitBranchSummary> = {},
): GitBranchSummary {
  return {
    name,
    current: false,
    remote: false,
    upstream: null,
    updatedAt: null,
    ...options,
  };
}

const prHeads: GithubPrHeadsResponse = {
  repository: "example/repo",
  prs: [
    {
      number: 42,
      url: "https://github.com/example/repo/pull/42",
      headRefName: "feature/recent",
      headRepository: "example/repo",
      isDraft: false,
      updatedAt: "2026-09-01T12:00:00.000Z",
    },
    {
      number: 99,
      url: "https://github.com/fork/repo/pull/99",
      headRefName: "collision",
      headRepository: "fork/repo",
      isDraft: true,
      updatedAt: "2026-09-02T12:00:00.000Z",
    },
  ],
};

test("groups branches and pins current and base before recent activity", () => {
  const groups = groupBranchesForDialog(
    [
      branch("old", { updatedAt: "2025-01-01T00:00:00.000Z" }),
      branch("main", { updatedAt: "2024-01-01T00:00:00.000Z" }),
      branch("feature/recent", {
        updatedAt: "2026-09-01T00:00:00.000Z",
      }),
      branch("working", {
        current: true,
        updatedAt: "2023-01-01T00:00:00.000Z",
      }),
      branch("origin/old", {
        remote: true,
        updatedAt: "2025-01-01T00:00:00.000Z",
      }),
      branch("origin/new", {
        remote: true,
        updatedAt: "2026-01-01T00:00:00.000Z",
      }),
      branch("undated"),
    ],
    "",
    "main",
    prHeads,
    Date.parse("2026-09-04T00:00:00.000Z"),
  );

  assert.deepEqual(
    groups.local.map((row) => row.branch.name),
    ["working", "main", "feature/recent", "old", "undated"],
  );
  assert.deepEqual(
    groups.remote.map((row) => row.branch.name),
    ["origin/new", "origin/old"],
  );
  assert.equal(groups.local[2]?.pullRequest?.number, 42);
  assert.equal(groups.local[2]?.updatedLabel, "Updated 3d ago");
});

test("filters branches by name, upstream, and pull request number", () => {
  const branches = [
    branch("feature/recent", { upstream: "origin/feature/recent" }),
    branch("collision"),
  ];

  assert.deepEqual(
    groupBranchesForDialog(
      branches,
      "origin/feature",
      undefined,
      prHeads,
    ).local.map((row) => row.branch.name),
    ["feature/recent"],
  );
  assert.deepEqual(
    groupBranchesForDialog(branches, "#42", undefined, prHeads).local.map(
      (row) => row.branch.name,
    ),
    ["feature/recent"],
  );
  assert.equal(
    groupBranchesForDialog(branches, "", undefined, prHeads).local.find(
      (row) => row.branch.name === "collision",
    )?.pullRequest,
    undefined,
  );
});

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
