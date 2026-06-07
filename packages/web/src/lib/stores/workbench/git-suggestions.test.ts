import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { GitRepoSummary } from "../../api";
import { buildGitSuggestions } from "./git-suggestions";
import type { GitContext } from "./state.svelte";

function repo(overrides: Partial<GitRepoSummary> = {}): GitRepoSummary {
  return {
    relativePath: ".",
    absDir: "/repo",
    name: "repo",
    isRepo: true,
    currentBranch: "main",
    detached: false,
    ahead: 0,
    behind: 0,
    hasUpstream: true,
    hasRemote: true,
    baseBranch: "main",
    onBaseBranch: true,
    mergedToBase: false,
    dirty: false,
    changeCount: 0,
    ...overrides,
  };
}

function ctx(
  repos: GitRepoSummary[],
  github: GitContext["github"] = { available: true, authenticated: true },
): GitContext {
  return {
    projectId: "p1",
    projectIsRepo: repos.length === 1 && repos[0]?.relativePath === ".",
    repos,
    github,
    loadedAt: 0,
  };
}

function ids(ctxValue: GitContext): string[] {
  return buildGitSuggestions(ctxValue).map((s) => s.id);
}

describe("buildGitSuggestions", () => {
  it("returns nothing for a clean repo with no unpushed commits", () => {
    assert.deepEqual(ids(ctx([repo()])), []);
  });

  it("offers commit, commit-branch and open-pr when dirty on the base branch", () => {
    assert.deepEqual(ids(ctx([repo({ dirty: true, changeCount: 2 })])), [
      "commit",
      "commit-branch",
      "open-pr",
    ]);
  });

  it("omits commit-branch when already on a feature branch", () => {
    const dirtyFeature = repo({
      currentBranch: "feature/x",
      onBaseBranch: false,
      dirty: true,
      changeCount: 1,
    });
    assert.deepEqual(ids(ctx([dirtyFeature])), ["commit", "open-pr"]);
  });

  it("offers push (not commit) for a clean repo with unpushed commits", () => {
    const unpushed = repo({
      currentBranch: "feature/x",
      onBaseBranch: false,
      ahead: 2,
    });
    const result = buildGitSuggestions(ctx([unpushed]));
    assert.deepEqual(
      result.map((s) => s.id),
      ["open-pr", "push"],
    );
    assert.equal(result.find((s) => s.id === "open-pr")?.label, "Create a PR");
  });

  it("drops open-pr when GitHub is unavailable", () => {
    const dirty = repo({ dirty: true, changeCount: 1 });
    assert.deepEqual(
      ids(ctx([dirty], { available: false, authenticated: false })),
      ["commit", "commit-branch"],
    );
  });

  it("labels open-pr 'Create PRs' and scopes prompts for multiple unpushed repos", () => {
    const a = repo({
      relativePath: "api",
      name: "api",
      currentBranch: "feature/x",
      onBaseBranch: false,
      ahead: 1,
    });
    const b = repo({
      relativePath: "web",
      name: "web",
      currentBranch: "feature/x",
      onBaseBranch: false,
      ahead: 3,
    });
    const result = buildGitSuggestions(ctx([a, b]));
    const openPr = result.find((s) => s.id === "open-pr");
    const push = result.find((s) => s.id === "push");
    assert.equal(openPr?.label, "Create PRs");
    assert.match(openPr?.prompt ?? "", /api, web/);
    assert.match(push?.prompt ?? "", /api, web/);
  });

  it("scopes the commit prompt across multiple dirty repos", () => {
    const a = repo({
      relativePath: "api",
      name: "api",
      dirty: true,
      changeCount: 1,
    });
    const b = repo({
      relativePath: "web",
      name: "web",
      dirty: true,
      changeCount: 1,
    });
    const commit = buildGitSuggestions(ctx([a, b])).find(
      (s) => s.id === "commit",
    );
    assert.match(commit?.prompt ?? "", /for these repositories: api, web/);
  });
});
