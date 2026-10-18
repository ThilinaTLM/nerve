import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  GitBranchSummary,
  GitFileChange,
  GithubPrHeadsResponse,
  GitRepoSummary,
} from "@nervekit/contracts/git";
import { buildPanelTree } from "$lib/presentation/panels/panel-tree";
import {
  createGitPanelActions,
  canDeleteBranch,
  gitChangeTreeFolderKey,
  gitRepoChipSplit,
  gitExpandedGroupIds,
  gitFilesInScope,
  gitPathspecs,
  groupBranchesForDialog,
  isPlausibleBranchName,
  shouldLoadRepoBranches,
} from "./git-panel-controller.js";

import type { GitPanelActions, GitPanelModel } from "./git-panel-types.js";

void test("bulk and cancellation actions preserve capabilities and tracked-ID policy", () => {
  let enabled = false;
  let basePullEnabled = false;
  const calls: string[] = [];
  const model = {
    availability: { available: true },
    capabilities: {
      remote: {
        "switch-base-and-pull": {
          get enabled() {
            return basePullEnabled;
          },
        },
        fetch: {
          get enabled() {
            return enabled;
          },
        },
      },
    },
    activeOperations: [
      { id: "running", actions: { cancel: true } },
      { id: "finished", actions: { cancel: false } },
    ],
  } as unknown as GitPanelModel;
  const host = {
    runBulkRemoteOperation: (kind: string) => {
      calls.push(kind);
    },
    cancelOperation: (id: string) => {
      calls.push(id);
    },
  } as unknown as GitPanelActions;
  const actions = createGitPanelActions(() => model, host);
  void actions.runBulkRemoteOperation?.("fetch");
  assert.deepEqual(calls, []);
  enabled = true;
  void actions.runBulkRemoteOperation?.("fetch");
  void actions.cancelOperation?.("missing");
  void actions.cancelOperation?.("finished");
  void actions.cancelOperation?.("running");
  assert.deepEqual(calls, ["fetch", "running"]);
  // Bulk base switching follows its own mutation capability, not fetch/pull.
  void actions.runBulkRemoteOperation?.("switch-base-and-pull");
  assert.deepEqual(calls, ["fetch", "running"]);
  basePullEnabled = true;
  void actions.runBulkRemoteOperation?.("switch-base-and-pull");
  assert.deepEqual(calls, ["fetch", "running", "switch-base-and-pull"]);
});

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

test("loads a repository's branches once per picker, retrying empty results", () => {
  const requested = new Set<string>();
  // First open of any repository always fetches.
  assert.equal(shouldLoadRepoBranches(requested, "api", 0), true);
  requested.add("api");
  // A cached list is not refetched on reopen.
  assert.equal(shouldLoadRepoBranches(requested, "api", 4), false);
  // An earlier request that yielded nothing is retried instead of stranding
  // the picker on a permanently empty list.
  assert.equal(shouldLoadRepoBranches(requested, "api", 0), true);
  // Requesting one repository never satisfies another.
  assert.equal(shouldLoadRepoBranches(requested, "web-app", 7), true);
});

function repoSummary(relativePath: string): GitRepoSummary {
  return {
    relativePath,
    absDir: `/tmp/${relativePath}`,
    name: relativePath,
    isRepo: true,
    currentBranch: "main",
    detached: false,
    ahead: 0,
    behind: 0,
    hasUpstream: true,
    hasRemote: true,
    hasGithubRemote: true,
    baseBranch: "main",
    onBaseBranch: true,
    mergedToBase: true,
    dirty: false,
    changeCount: 0,
  };
}

test("repository chips keep every repo inline while they fit", () => {
  const repos = ["a", "b", "c"].map(repoSummary);
  const split = gitRepoChipSplit(repos, "b", 4);
  assert.deepEqual(
    split.visible.map((repo) => repo.relativePath),
    ["a", "b", "c"],
  );
  assert.deepEqual(split.overflow, []);
});

test("repository chips move the tail into the overflow menu", () => {
  const repos = ["a", "b", "c", "d", "e"].map(repoSummary);
  const split = gitRepoChipSplit(repos, "a", 3);
  assert.deepEqual(
    split.visible.map((repo) => repo.relativePath),
    ["a", "b", "c"],
  );
  assert.deepEqual(
    split.overflow.map((repo) => repo.relativePath),
    ["d", "e"],
  );
});

test("repository chips always keep the selected repository visible", () => {
  const repos = ["a", "b", "c", "d", "e"].map(repoSummary);
  const split = gitRepoChipSplit(repos, "e", 3);
  assert.deepEqual(
    split.visible.map((repo) => repo.relativePath),
    ["a", "b", "e"],
  );
  assert.deepEqual(
    split.overflow.map((repo) => repo.relativePath),
    ["c", "d"],
  );
});

test("accepts plausible branch names and rejects obviously invalid ones", () => {
  for (const name of ["feature/login", "  fix-1  ", "release-2.0"]) {
    assert.equal(isPlausibleBranchName(name), true, name);
  }
  for (const name of [
    "",
    "   ",
    "has space",
    "-leading",
    "/leading",
    "trailing/",
    "a..b",
    "bell\u0007",
    "tilde~1",
    "caret^",
    "co:lon",
    "what?",
    "star*",
    "br[acket",
    "back\\slash",
  ]) {
    assert.equal(isPlausibleBranchName(name), false, JSON.stringify(name));
  }
});

test("allows deleting only local branches that are not current or the base", () => {
  const branch = { name: "feature", remote: false, current: false };
  assert.equal(canDeleteBranch(branch, "main"), true);
  assert.equal(canDeleteBranch(branch, undefined), true);
  assert.equal(canDeleteBranch({ ...branch, remote: true }, "main"), false);
  assert.equal(canDeleteBranch({ ...branch, current: true }, "main"), false);
  assert.equal(canDeleteBranch({ ...branch, name: "main" }, "main"), false);
});

void test("stash reads require an available project and stash capability", async () => {
  let available = true;
  let enabled = false;
  const calls: string[] = [];
  const model = () =>
    ({
      availability: { available },
      capabilities: { stashes: { enabled } },
    }) as unknown as GitPanelModel;
  const host = {
    loadStashes: async (repository: string) => {
      calls.push(repository);
      return [];
    },
  } as unknown as GitPanelActions;
  const actions = createGitPanelActions(model, host);
  assert.equal(await actions.loadStashes("other"), undefined);
  assert.deepEqual(calls, []);
  enabled = true;
  assert.deepEqual(await actions.loadStashes("other"), []);
  assert.deepEqual(calls, ["other"]);
  available = false;
  assert.equal(await actions.loadStashes("other"), undefined);
  assert.deepEqual(calls, ["other"]);
});
