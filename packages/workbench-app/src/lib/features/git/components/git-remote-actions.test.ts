import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { GitRepoSummary } from "$lib/api";
import {
  pullDisabled,
  pushDisabled,
  remoteActionDisabled,
  showPull,
  showPush,
  syncDisabled,
} from "./git-remote-actions";

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

describe("git remote action helpers", () => {
  it("keeps remote actions disabled without a remote or while another action runs", () => {
    assert.equal(remoteActionDisabled(repo({ hasRemote: false }), false), true);
    assert.equal(syncDisabled(repo({ hasRemote: false }), false), true);
    assert.equal(remoteActionDisabled(repo(), true), true);
    assert.equal(syncDisabled(repo(), true), true);
  });

  it("disables sync for detached HEAD", () => {
    assert.equal(syncDisabled(repo({ detached: true }), false), true);
  });

  it("shows pull whenever upstream commits are behind, including divergence", () => {
    assert.equal(showPull(repo({ ahead: 0, behind: 2 })), true);
    assert.equal(showPull(repo({ ahead: 3, behind: 2 })), true);
    assert.equal(pullDisabled(repo({ ahead: 3, behind: 2 }), false), false);
  });

  it("shows push whenever local commits are ahead, including divergence", () => {
    assert.equal(showPush(repo({ ahead: 2, behind: 0 })), true);
    assert.equal(showPush(repo({ ahead: 2, behind: 3 })), true);
    assert.equal(pushDisabled(repo({ ahead: 2, behind: 3 }), false), false);
  });

  it("hides pull without upstream and hides push without known ahead commits", () => {
    assert.equal(showPull(repo({ hasUpstream: false, behind: null })), false);
    assert.equal(showPush(repo({ ahead: 0 })), false);
    assert.equal(showPush(repo({ ahead: null })), false);
  });

  it("disables pull on dirty worktrees", () => {
    assert.equal(pullDisabled(repo({ behind: 1, dirty: true }), false), true);
  });
});
