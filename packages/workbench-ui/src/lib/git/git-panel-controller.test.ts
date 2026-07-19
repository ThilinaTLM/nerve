import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { GitBranchSummary, GithubPr } from "@nervekit/contracts";
import {
  createGitPanelActions,
  filterAndSortBranches,
  sortPullRequests,
} from "./git-panel-controller.js";
import {
  disabledCapability,
  enabledCapability,
  type GitPanelActions,
  type GitPanelModel,
} from "./git-panel-types.js";

const checks = {
  status: "none" as const,
  total: 0,
  passed: 0,
  failed: 0,
  pending: 0,
  runs: [],
};
const operationState = {
  fetching: false,
  pulling: false,
  pushing: false,
  syncing: false,
  switchingBaseAndPulling: false,
  creatingBranch: false,
};

function model(enabled = true): GitPanelModel {
  const capability = enabled
    ? enabledCapability
    : disabledCapability("unsupported");
  return {
    availability: { available: true },
    repositories: [],
    selectedRepository: ".",
    branches: [],
    pullRequests: [],
    initialLoading: false,
    refreshing: false,
    loadingOverview: false,
    loadingBranches: false,
    loadingPullRequests: false,
    operations: operationState,
    capabilities: {
      refresh: capability,
      selectRepository: capability,
      branches: capability,
      mutateFiles: capability,
      bulkMutateFiles: capability,
      remote: {
        fetch: capability,
        pull: capability,
        push: capability,
        sync: capability,
        "switch-base-and-pull": capability,
      },
      openPullRequest: capability,
    },
  };
}

function host(onCall: (name: keyof GitPanelActions) => void): GitPanelActions {
  return {
    refreshAll: () => onCall("refreshAll"),
    refreshRepository: () => onCall("refreshRepository"),
    refreshBranches: () => onCall("refreshBranches"),
    refreshPullRequests: () => onCall("refreshPullRequests"),
    selectRepository: () => onCall("selectRepository"),
    createBranch: () => (onCall("createBranch"), true),
    switchBranch: () => (onCall("switchBranch"), true),
    mutateFile: () => onCall("mutateFile"),
    bulkMutateFiles: () => onCall("bulkMutateFiles"),
    runRemoteOperation: () => onCall("runRemoteOperation"),
    selectPullRequest: () => onCall("selectPullRequest"),
    openPullRequest: () => onCall("openPullRequest"),
  };
}

describe("Git panel selectors", () => {
  it("filters branches and keeps the current branch first", () => {
    const branches: GitBranchSummary[] = [
      { name: "feature/z", current: false, remote: false, upstream: null },
      { name: "feature/a", current: true, remote: false, upstream: null },
      { name: "main", current: false, remote: false, upstream: null },
    ];
    assert.deepEqual(
      filterAndSortBranches(branches, "feature").map((branch) => branch.name),
      ["feature/a", "feature/z"],
    );
  });

  it("prioritizes the current branch, then the base branch", () => {
    const branches: GitBranchSummary[] = [
      { name: "feature/z", current: false, remote: false, upstream: null },
      { name: "main", current: false, remote: false, upstream: null },
      { name: "feature/a", current: true, remote: false, upstream: null },
    ];
    assert.deepEqual(
      filterAndSortBranches(branches, "", "main").map((branch) => branch.name),
      ["feature/a", "main", "feature/z"],
    );
  });

  it("sorts the current branch PR first and remaining PRs by update time", () => {
    const pr = (
      number: number,
      headRefName: string,
      updatedAt: string,
    ): GithubPr => ({
      number,
      headRefName,
      updatedAt,
      title: `PR ${number}`,
      url: `https://example.test/${number}`,
      state: "OPEN",
      isDraft: false,
      baseRefName: "main",
      checks,
    });
    const sorted = sortPullRequests(
      [
        pr(1, "old", "2026-01-01T00:00:00Z"),
        pr(2, "current", "2025-01-01T00:00:00Z"),
        pr(3, "new", "2026-02-01T00:00:00Z"),
      ],
      "current",
    );
    assert.deepEqual(
      sorted.map((item) => item.number),
      [2, 3, 1],
    );
  });
});

describe("Git panel action controller", () => {
  it("forwards supported action arguments", async () => {
    const calls: Array<keyof GitPanelActions> = [];
    const actions = createGitPanelActions(
      () => model(true),
      host((name) => calls.push(name)),
    );
    await actions.runRemoteOperation(".", "fetch");
    await actions.createBranch(".", "feature/test");
    assert.deepEqual(calls, ["runRemoteOperation", "createBranch"]);
  });

  it("does not call host effects when a capability is absent", async () => {
    const calls: Array<keyof GitPanelActions> = [];
    const actions = createGitPanelActions(
      () => model(false),
      host((name) => calls.push(name)),
    );
    await actions.refreshAll();
    await actions.openPullRequest(".", 1);
    assert.equal(await actions.createBranch(".", "feature/test"), false);
    assert.deepEqual(calls, []);
  });
});
