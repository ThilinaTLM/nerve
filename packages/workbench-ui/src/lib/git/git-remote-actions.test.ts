import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { GitRepoSummary } from "@nervekit/contracts";
import {
  pullDisabled,
  pushDisabled,
  remoteActionDisabled,
  showPull,
  showPush,
  syncDisabled,
} from "./git-remote-actions.js";

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

describe("Git remote action selectors", () => {
  it("gates remote state and detached sync", () => {
    assert.equal(remoteActionDisabled(repo({ hasRemote: false }), false), true);
    assert.equal(syncDisabled(repo({ detached: true }), false), true);
    assert.equal(remoteActionDisabled(repo(), true), true);
  });

  it("supports pull and push for diverged branches", () => {
    const diverged = repo({ ahead: 3, behind: 2 });
    assert.equal(showPull(diverged), true);
    assert.equal(showPush(diverged), true);
    assert.equal(pullDisabled(diverged, false), false);
    assert.equal(pushDisabled(diverged, false), false);
  });
});
