import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  gitBranchListResponseSchema,
  gitDiscoveryResponseSchema,
  gitFileActionRequestSchema,
  githubPrListResponseSchema,
  githubStatusResponseSchema,
  gitOverviewResponseSchema,
  switchBranchRequestSchema,
} from "../src/domains/git/git.schema.js";

describe("git schemas", () => {
  it("parses a discovery response", () => {
    const parsed = gitDiscoveryResponseSchema.parse({
      projectIsRepo: false,
      repos: [
        {
          relativePath: "api",
          absDir: "/work/parent/api",
          name: "api",
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
        },
      ],
    });
    assert.equal(parsed.repos[0].name, "api");
  });

  it("parses an overview response", () => {
    const parsed = gitOverviewResponseSchema.parse({
      repo: {
        relativePath: ".",
        absDir: "/work/repo",
        name: "repo",
        isRepo: true,
        currentBranch: "feature/x",
        detached: false,
        ahead: null,
        behind: null,
        hasUpstream: false,
        hasRemote: true,
        hasGithubRemote: true,
        baseBranch: "main",
        onBaseBranch: false,
        mergedToBase: false,
        dirty: true,
        changeCount: 1,
      },
      baseBranch: "main",
      onBaseBranch: false,
      files: [
        {
          path: "src/a.ts",
          index: "M",
          worktree: " ",
          staged: true,
          untracked: false,
        },
      ],
      stagedCount: 1,
      unstagedCount: 0,
      untrackedCount: 0,
      insertions: 3,
      deletions: 1,
      recentCommits: [{ hash: "abc123", subject: "init", relativeDate: "1d" }],
    });
    assert.equal(parsed.files[0].index, "M");
  });

  it("parses a branch list response", () => {
    const parsed = gitBranchListResponseSchema.parse({
      branches: [
        { name: "main", current: true, remote: false, upstream: "origin/main" },
        {
          name: "origin/feature/x",
          current: false,
          remote: true,
          upstream: null,
        },
      ],
    });
    assert.equal(parsed.branches[0].current, true);
  });

  it("parses branch and file action requests", () => {
    const branch = switchBranchRequestSchema.parse({
      repo: "app",
      name: "feature/x",
    });
    const file = gitFileActionRequestSchema.parse({
      repo: "app",
      path: "src/a.ts",
    });
    assert.equal(branch.name, "feature/x");
    assert.equal(file.path, "src/a.ts");
  });

  it("parses a github status response", () => {
    const parsed = githubStatusResponseSchema.parse({
      available: true,
      authenticated: true,
      login: "octocat",
    });
    assert.equal(parsed.login, "octocat");
  });

  it("parses a github PR list with checks", () => {
    const parsed = githubPrListResponseSchema.parse({
      prs: [
        {
          number: 12,
          title: "Add feature",
          url: "https://github.com/o/r/pull/12",
          state: "OPEN",
          isDraft: false,
          headRefName: "feature/x",
          baseRefName: "main",
          updatedAt: "2026-01-01T00:00:00Z",
          checks: {
            status: "passing",
            total: 2,
            passed: 2,
            failed: 0,
            pending: 0,
            runs: [{ name: "build", status: "success", conclusion: "success" }],
          },
        },
      ],
    });
    assert.equal(parsed.prs[0].checks.status, "passing");
  });
});
