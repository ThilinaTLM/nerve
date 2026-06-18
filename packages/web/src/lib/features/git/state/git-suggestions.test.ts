import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { GitRepoSummary } from "$lib/api";
import type { GitContext } from "$lib/features/state-types";
import { buildGitSuggestions } from "./git-suggestions";

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
    hasGithubRemote: true,
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

  it("offers open-pr (not push) for a clean feature branch with unpushed commits", () => {
    const unpushed = repo({
      currentBranch: "feature/x",
      onBaseBranch: false,
      ahead: 2,
    });
    const result = buildGitSuggestions(ctx([unpushed]));
    assert.deepEqual(
      result.map((s) => s.id),
      ["open-pr"],
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

  it("drops open-pr for local or non-GitHub remote repositories", () => {
    const local = repo({
      dirty: true,
      hasRemote: false,
      hasGithubRemote: false,
    });
    const nonGithub = repo({
      relativePath: "mirror",
      name: "mirror",
      dirty: true,
      hasGithubRemote: false,
    });

    assert.deepEqual(ids(ctx([local])), ["commit", "commit-branch"]);
    assert.deepEqual(ids(ctx([nonGithub])), ["commit", "commit-branch"]);
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
    assert.equal(openPr?.label, "Create PRs");
    assert.match(openPr?.prompt ?? "", /api, web/);
  });

  it("does not offer open-pr or push for a clean base branch with committed changes", () => {
    const committedOnBase = repo({
      ahead: 2,
    });
    assert.deepEqual(ids(ctx([committedOnBase])), []);
  });

  it("offers open-pr for an already-pushed feature branch with unmerged commits", () => {
    const pushedFeature = repo({
      currentBranch: "feature/x",
      onBaseBranch: false,
      ahead: 0,
      mergedToBase: false,
    });
    assert.deepEqual(ids(ctx([pushedFeature])), ["open-pr"]);
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
