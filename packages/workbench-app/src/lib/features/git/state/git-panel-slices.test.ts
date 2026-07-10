import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { GithubPr, GitOverviewResponse, GitRepoSummary } from "$lib/api";
import {
  changesFingerprint,
  changesFromOverview,
  overviewFingerprint,
  prsFingerprint,
  recentCommitsFingerprint,
  repoSummaryFingerprint,
} from "./git-panel-slices";

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

function overview(
  overrides: Partial<GitOverviewResponse> = {},
): GitOverviewResponse {
  return {
    repo: repo(),
    baseBranch: "main",
    onBaseBranch: true,
    files: [],
    stagedCount: 0,
    unstagedCount: 0,
    untrackedCount: 0,
    insertions: 0,
    deletions: 0,
    recentCommits: [
      { hash: "a1", subject: "Initial", relativeDate: "1 hour ago" },
    ],
    ...overrides,
  };
}

function pr(overrides: Partial<GithubPr> = {}): GithubPr {
  return {
    number: 1,
    title: "Update git panel",
    url: "https://github.com/acme/repo/pull/1",
    state: "OPEN",
    isDraft: false,
    headRefName: "feature/git-panel",
    baseRefName: "main",
    updatedAt: "2026-06-24T00:00:00Z",
    checks: {
      status: "passing",
      total: 1,
      passed: 1,
      failed: 0,
      pending: 0,
      runs: [{ name: "test", status: "completed", conclusion: "success" }],
    },
    ...overrides,
  };
}

describe("git panel slice fingerprints", () => {
  it("keeps all fingerprints stable for an unchanged overview response", () => {
    const first = overview();
    const second = overview();

    assert.equal(overviewFingerprint(first), overviewFingerprint(second));
    assert.equal(
      repoSummaryFingerprint(first.repo),
      repoSummaryFingerprint(second.repo),
    );
    assert.equal(
      changesFingerprint(changesFromOverview(first)),
      changesFingerprint(changesFromOverview(second)),
    );
    assert.equal(
      recentCommitsFingerprint(first.recentCommits),
      recentCommitsFingerprint(second.recentCommits),
    );
  });

  it("isolates branch-only changes to the repo summary slice", () => {
    const first = overview();
    const second = overview({
      repo: repo({ currentBranch: "feature/git-panel", onBaseBranch: false }),
    });

    assert.notEqual(
      repoSummaryFingerprint(first.repo),
      repoSummaryFingerprint(second.repo),
    );
    assert.equal(
      changesFingerprint(changesFromOverview(first)),
      changesFingerprint(changesFromOverview(second)),
    );
    assert.equal(
      recentCommitsFingerprint(first.recentCommits),
      recentCommitsFingerprint(second.recentCommits),
    );
  });

  it("isolates file changes to the changes slice", () => {
    const first = overview();
    const second = overview({
      repo: repo({ dirty: true, changeCount: 1 }),
      files: [
        {
          path: "src/app.ts",
          index: " ",
          worktree: "M",
          staged: false,
          untracked: false,
        },
      ],
      unstagedCount: 1,
      insertions: 4,
    });

    assert.notEqual(
      changesFingerprint(changesFromOverview(first)),
      changesFingerprint(changesFromOverview(second)),
    );
    assert.equal(
      recentCommitsFingerprint(first.recentCommits),
      recentCommitsFingerprint(second.recentCommits),
    );
  });

  it("isolates recent commit changes to the commits slice", () => {
    const first = overview();
    const second = overview({
      recentCommits: [
        { hash: "b2", subject: "Refine state", relativeDate: "now" },
      ],
    });

    assert.equal(
      repoSummaryFingerprint(first.repo),
      repoSummaryFingerprint(second.repo),
    );
    assert.equal(
      changesFingerprint(changesFromOverview(first)),
      changesFingerprint(changesFromOverview(second)),
    );
    assert.notEqual(
      recentCommitsFingerprint(first.recentCommits),
      recentCommitsFingerprint(second.recentCommits),
    );
  });

  it("keeps PR fingerprints stable for unchanged polling responses", () => {
    assert.equal(prsFingerprint([pr()]), prsFingerprint([pr()]));
    assert.notEqual(
      prsFingerprint([pr()]),
      prsFingerprint([
        pr({
          checks: { ...pr().checks, status: "pending", pending: 1, passed: 0 },
        }),
      ]),
    );
  });
});
