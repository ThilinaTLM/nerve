import assert from "node:assert/strict";
import test from "node:test";
import type { GitDiscoveryResponse, GitRepoSummary } from "$lib/api";
import { summarizeProjectGit } from "./project-overview";

function repo(patch: Partial<GitRepoSummary> = {}): GitRepoSummary {
  return {
    relativePath: ".",
    absDir: "/work/app",
    name: "app",
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
    ...patch,
  };
}

function discovery(repos: GitRepoSummary[]): GitDiscoveryResponse {
  return { projectIsRepo: repos.length === 1, repos };
}

test("summarizes an empty Git project", () => {
  assert.deepEqual(summarizeProjectGit(discovery([])), {
    repositoryCount: 0,
    branch: undefined,
    detached: false,
    changeCount: 0,
    aheadCount: 0,
    upstreamKnown: false,
  });
});

test("shows branch and status totals for one repository", () => {
  assert.deepEqual(
    summarizeProjectGit(discovery([repo({ changeCount: 4, ahead: 2 })])),
    {
      repositoryCount: 1,
      branch: "main",
      detached: false,
      changeCount: 4,
      aheadCount: 2,
      upstreamKnown: true,
    },
  );
});

test("represents detached HEAD and ignores unknown upstream counts", () => {
  const result = summarizeProjectGit(
    discovery([repo({ currentBranch: null, detached: true, ahead: null })]),
  );
  assert.equal(result.branch, undefined);
  assert.equal(result.detached, true);
  assert.equal(result.aheadCount, 0);
  assert.equal(result.upstreamKnown, true);
});

test("aggregates multiple repositories without choosing a branch", () => {
  assert.deepEqual(
    summarizeProjectGit(
      discovery([
        repo({ changeCount: 2, ahead: 1 }),
        repo({
          relativePath: "packages/api",
          currentBranch: "feature/api",
          changeCount: 3,
          ahead: 4,
        }),
      ]),
    ),
    {
      repositoryCount: 2,
      branch: undefined,
      detached: false,
      changeCount: 5,
      aheadCount: 5,
      upstreamKnown: true,
    },
  );
});
