import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { GitRepoSummary } from "../../api";
import {
  gitContextFingerprint,
  shouldRefreshGitContextOnFocus,
} from "./git-context-helpers";
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
    hasGithubRemote: true,
    baseBranch: "main",
    onBaseBranch: true,
    mergedToBase: false,
    dirty: false,
    changeCount: 0,
    ...overrides,
  };
}

function ctx(overrides: Partial<GitContext> = {}): GitContext {
  return {
    projectId: "p1",
    projectIsRepo: true,
    repos: [repo()],
    github: { available: true, authenticated: true },
    loadedAt: 1_000,
    ...overrides,
  };
}

describe("gitContextFingerprint", () => {
  it("changes when suggestion-relevant repo state changes", () => {
    const clean = ctx();
    const dirty = ctx({ repos: [repo({ dirty: true, changeCount: 1 })] });

    assert.notEqual(gitContextFingerprint(clean), gitContextFingerprint(dirty));
  });

  it("changes when branch and merge state changes", () => {
    const base = ctx();
    const feature = ctx({
      repos: [
        repo({
          currentBranch: "feature/git-refresh",
          onBaseBranch: false,
          mergedToBase: false,
        }),
      ],
    });

    assert.notEqual(
      gitContextFingerprint(base),
      gitContextFingerprint(feature),
    );
  });

  it("changes when GitHub availability changes", () => {
    const authenticated = ctx();
    const unavailable = ctx({
      github: { available: false, authenticated: false },
    });

    assert.notEqual(
      gitContextFingerprint(authenticated),
      gitContextFingerprint(unavailable),
    );
  });

  it("changes when GitHub remote eligibility changes", () => {
    const githubRemote = ctx();
    const nonGithubRemote = ctx({
      repos: [repo({ hasGithubRemote: false })],
    });

    assert.notEqual(
      gitContextFingerprint(githubRemote),
      gitContextFingerprint(nonGithubRemote),
    );
  });

  it("ignores loadedAt freshness", () => {
    assert.equal(
      gitContextFingerprint(ctx({ loadedAt: 1_000 })),
      gitContextFingerprint(ctx({ loadedAt: 2_000 })),
    );
  });
});

describe("shouldRefreshGitContextOnFocus", () => {
  it("refreshes for missing or wrong-project context", () => {
    assert.equal(
      shouldRefreshGitContextOnFocus(undefined, "p1", 2_000, 5_000),
      true,
    );
    assert.equal(
      shouldRefreshGitContextOnFocus(
        ctx({ projectId: "p2" }),
        "p1",
        2_000,
        5_000,
      ),
      true,
    );
  });

  it("refreshes stale active context", () => {
    assert.equal(
      shouldRefreshGitContextOnFocus(
        ctx({ loadedAt: 1_000 }),
        "p1",
        6_000,
        5_000,
      ),
      true,
    );
  });

  it("does not refresh fresh active context or missing project", () => {
    assert.equal(
      shouldRefreshGitContextOnFocus(
        ctx({ loadedAt: 1_000 }),
        "p1",
        5_999,
        5_000,
      ),
      false,
    );
    assert.equal(
      shouldRefreshGitContextOnFocus(ctx(), undefined, 10_000, 5_000),
      false,
    );
  });
});
