import type { GithubPrCore } from "@nervekit/contracts/git";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { prSummaryFromCore } from "./pr-sync.js";

const passingChecks = {
  status: "passing" as const,
  total: 2,
  passed: 2,
  failed: 0,
  pending: 0,
  runs: [
    { name: "Test", status: "SUCCESS", conclusion: "SUCCESS" },
    { name: "CodeQL", status: "SUCCESS", conclusion: "SUCCESS" },
  ],
};

const core: GithubPrCore = {
  number: 42,
  headSha: "abcdef123456",
  title: "Progressive PR details",
  url: "https://github.com/owner/repo/pull/42",
  state: "OPEN",
  isDraft: false,
  headRefName: "feature/progressive-pr",
  baseRefName: "main",
  headRefOid: "abcdef123456",
  baseRefOid: "123456abcdef",
  updatedAt: "2026-07-29T02:10:00Z",
  createdAt: "2026-07-29T02:00:00Z",
  author: "octocat",
  commentCount: 4,
  additions: 10,
  deletions: 2,
  changedFiles: 3,
};

describe("pull request summary sync", () => {
  it("projects list fields from core and checks", () => {
    assert.deepEqual(prSummaryFromCore(core, passingChecks), {
      number: core.number,
      headSha: core.headRefOid,
      headRepository: null,
      labels: [],
      reviewRequested: false,
      title: core.title,
      url: core.url,
      state: core.state,
      isDraft: core.isDraft,
      headRefName: core.headRefName,
      baseRefName: core.baseRefName,
      updatedAt: core.updatedAt,
      author: core.author,
      commentCount: core.commentCount,
      additions: core.additions,
      deletions: core.deletions,
      checks: passingChecks,
    });
  });
});
