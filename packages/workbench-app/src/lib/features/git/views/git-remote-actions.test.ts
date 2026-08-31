import assert from "node:assert/strict";
import { test } from "node:test";
import type { GitRepoSummary } from "@nervekit/contracts/git";
import {
  basePullDisabled,
  pullDisabled,
  remoteActionDisabled,
} from "./git-remote-actions.js";

function repo(overrides: Partial<GitRepoSummary> = {}): GitRepoSummary {
  return {
    relativePath: ".",
    absDir: "/repo",
    name: "repo",
    isRepo: true,
    currentBranch: "feature",
    detached: false,
    ahead: 0,
    behind: 1,
    hasUpstream: true,
    hasRemote: true,
    hasGithubRemote: false,
    baseBranch: "main",
    onBaseBranch: false,
    mergedToBase: false,
    dirty: false,
    changeCount: 0,
    ...overrides,
  };
}

test("allows pull and base switching with compatible local changes", () => {
  const dirtyRepo = repo({ dirty: true, changeCount: 1 });

  assert.equal(pullDisabled(dirtyRepo, false), false);
  assert.equal(basePullDisabled(dirtyRepo, false), false);
});

test("keeps actual remote-operation prerequisites disabled", () => {
  assert.equal(remoteActionDisabled(repo({ hasRemote: false }), false), true);
  assert.equal(pullDisabled(repo({ hasUpstream: false }), false), true);
  assert.equal(pullDisabled(repo({ detached: true }), false), true);
  assert.equal(pullDisabled(repo(), true), true);
  assert.equal(basePullDisabled(repo({ hasRemote: false }), false), true);
  assert.equal(basePullDisabled(repo(), true), true);
});
