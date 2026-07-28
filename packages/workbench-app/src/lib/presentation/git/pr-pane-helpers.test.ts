import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { GithubPrDetail } from "@nervekit/contracts";
import {
  defaultMergeMethod,
  divergenceLabel,
  fileStatusLetter,
  mergeReadiness,
  prTimeline,
} from "./pr-pane-helpers.js";

function detail(overrides: Partial<GithubPrDetail> = {}): GithubPrDetail {
  return {
    number: 7,
    title: "PR",
    url: "https://github.com/example/repo/pull/7",
    state: "OPEN",
    isDraft: false,
    headRefName: "feature",
    baseRefName: "main",
    headRefOid: "head1234567",
    baseRefOid: "base1234567",
    updatedAt: "2026-07-22T00:00:00Z",
    createdAt: "2026-07-20T00:00:00Z",
    body: "",
    author: "octocat",
    additions: 1,
    deletions: 1,
    changedFiles: 1,
    mergeable: "MERGEABLE",
    mergeStateStatus: "CLEAN",
    reviewDecision: "APPROVED",
    behindBy: 0,
    comments: [],
    reviews: [],
    labels: [],
    reviewRequests: [],
    mergeSettings: { allowedMethods: ["merge", "squash"] },
    commits: [],
    checks: {
      status: "passing",
      total: 1,
      passed: 1,
      failed: 0,
      pending: 0,
      runs: [],
    },
    ...overrides,
  };
}

describe("PR pane helpers", () => {
  it("derives merge readiness and known blockers", () => {
    assert.equal(mergeReadiness(detail()).status, "ready");
    const blocked = mergeReadiness(
      detail({
        mergeStateStatus: "BEHIND",
        behindBy: 2,
        reviewDecision: "CHANGES_REQUESTED",
        checks: {
          status: "failing",
          total: 1,
          passed: 0,
          failed: 1,
          pending: 0,
          runs: [],
        },
      }),
    );
    assert.equal(blocked.status, "blocked");
    assert.ok(blocked.reasons.some((reason) => reason.includes("base")));
    assert.ok(blocked.reasons.some((reason) => reason.includes("checks")));
    assert.equal(
      mergeReadiness(detail({ mergeable: "UNKNOWN" })).status,
      "unknown",
    );
  });

  it("selects a deterministic allowed merge method", () => {
    assert.equal(defaultMergeMethod(["rebase", "squash"]), "squash");
    assert.equal(defaultMergeMethod(["merge", "squash"]), "merge");
    assert.equal(defaultMergeMethod([]), undefined);
  });

  it("orders comments and reviews chronologically", () => {
    const timeline = prTimeline(
      detail({
        comments: [
          {
            id: "comment",
            author: "a",
            body: "later",
            createdAt: "2026-07-22T00:00:00Z",
          },
        ],
        reviews: [
          {
            id: "review",
            author: "b",
            state: "APPROVED",
            body: "earlier",
            submittedAt: "2026-07-21T00:00:00Z",
          },
        ],
      }),
    );
    assert.deepEqual(
      timeline.map((entry) => entry.kind),
      ["review", "comment"],
    );
  });

  it("formats divergence and file statuses", () => {
    assert.equal(
      divergenceLabel(detail({ behindBy: 0 })),
      "Up to date with base",
    );
    assert.equal(
      divergenceLabel(detail({ behindBy: 1 })),
      "1 commit behind base",
    );
    assert.equal(fileStatusLetter("renamed"), "R");
    assert.equal(fileStatusLetter("modified"), "M");
  });
});
