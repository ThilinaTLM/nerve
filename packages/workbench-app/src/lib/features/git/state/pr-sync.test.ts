import type { GithubPr, GithubPrDetail } from "@nervekit/contracts";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { prSummariesEqual, prSummaryFromDetail } from "./pr-sync.js";

const passingChecks = {
  status: "passing" as const,
  total: 8,
  passed: 8,
  failed: 0,
  pending: 0,
  runs: [
    { name: "Check and test (Ubuntu)", status: "SUCCESS", conclusion: "1" },
    { name: "CodeQL", status: "SUCCESS", conclusion: "1" },
  ],
};

const pendingChecks = {
  status: "pending" as const,
  total: 8,
  passed: 1,
  failed: 0,
  pending: 7,
  runs: [
    {
      name: "Check and test (Ubuntu)",
      status: "IN_PROGRESS",
      conclusion: null,
    },
    { name: "CodeQL", status: "SUCCESS", conclusion: "1" },
  ],
};

function detail(overrides: Partial<GithubPrDetail> = {}): GithubPrDetail {
  return {
    number: 42,
    title: "Redesign pull request detail pane",
    url: "https://github.com/owner/repo/pull/42",
    state: "OPEN",
    isDraft: false,
    headRefName: "feature/github-like-pr-pane",
    baseRefName: "main",
    updatedAt: "2026-07-29T02:10:00Z",
    checks: passingChecks,
    body: "",
    author: "ThilinaTLM",
    createdAt: "2026-07-29T02:00:00Z",
    additions: 2842,
    deletions: 415,
    changedFiles: 25,
    mergeable: "MERGEABLE",
    mergeStateStatus: "CLEAN",
    reviewDecision: null,
    headRefOid: "500f7d1c",
    baseRefOid: "c49bd1c8",
    behindBy: 0,
    comments: [],
    reviews: [],
    labels: [],
    reviewRequests: [],
    mergeSettings: { allowedMethods: ["squash"] },
    commits: [],
    ...overrides,
  };
}

describe("pull request summary sync", () => {
  it("projects the list row fields from a loaded detail", () => {
    const summary = prSummaryFromDetail(detail());
    assert.deepEqual(summary, {
      number: 42,
      title: "Redesign pull request detail pane",
      url: "https://github.com/owner/repo/pull/42",
      state: "OPEN",
      isDraft: false,
      headRefName: "feature/github-like-pr-pane",
      baseRefName: "main",
      updatedAt: "2026-07-29T02:10:00Z",
      checks: passingChecks,
    } satisfies GithubPr);
  });

  it("ignores key and check-run order but detects real changes", () => {
    const summary = prSummaryFromDetail(detail());
    const reordered: GithubPr = {
      checks: passingChecks,
      updatedAt: summary.updatedAt,
      baseRefName: summary.baseRefName,
      headRefName: summary.headRefName,
      isDraft: summary.isDraft,
      state: summary.state,
      url: summary.url,
      title: summary.title,
      number: summary.number,
    };
    assert.equal(prSummariesEqual(summary, reordered), true);

    // The list and detail endpoints report the same runs in different orders.
    assert.equal(
      prSummariesEqual(
        summary,
        prSummaryFromDetail(
          detail({
            checks: {
              ...passingChecks,
              runs: [...passingChecks.runs].reverse(),
            },
          }),
        ),
      ),
      true,
    );

    assert.equal(
      prSummariesEqual(
        summary,
        prSummaryFromDetail(detail({ checks: pendingChecks })),
      ),
      false,
    );
    assert.equal(
      prSummariesEqual(
        summary,
        prSummaryFromDetail(detail({ state: "MERGED" })),
      ),
      false,
    );
    assert.equal(
      prSummariesEqual(
        summary,
        prSummaryFromDetail(detail({ updatedAt: "2026-07-29T03:00:00Z" })),
      ),
      false,
    );
  });
});
