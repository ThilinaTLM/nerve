import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
  GithubChecksSummary,
  GithubPrConversation,
  GithubPrCore,
  GithubPrOverview,
} from "@nervekit/contracts";
import {
  defaultMergeMethod,
  divergenceLabel,
  fileStatusLetter,
  formatRelativePrDate,
  mergeReadiness,
  prTimeline,
  reviewSurfaceClass,
  shouldCollapseBody,
  sortCheckRuns,
} from "./pr-pane-helpers.js";

type MergeDetail = GithubPrCore &
  GithubPrOverview & {
    checks: GithubChecksSummary;
  };

function detail(overrides: Partial<MergeDetail> = {}): MergeDetail {
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
    author: "octocat",
    additions: 1,
    deletions: 1,
    changedFiles: 1,
    mergeable: "MERGEABLE",
    mergeStateStatus: "CLEAN",
    reviewDecision: "APPROVED",
    viewerPermission: null,
    behindBy: 0,
    labels: [],
    reviewRequests: [],
    mergeSettings: { allowedMethods: ["merge", "squash"] },
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

  it("flags override merging for admins blocked only by requirements", () => {
    const blocked = (
      viewerPermission: "ADMIN" | "MAINTAIN" | "WRITE" | "READ" | null,
    ) =>
      mergeReadiness(detail({ viewerPermission, mergeStateStatus: "BLOCKED" }));
    assert.equal(mergeReadiness(detail()).canOverride, false);
    assert.equal(blocked(null).status, "blocked");
    assert.equal(blocked(null).canOverride, false);
    assert.equal(blocked("WRITE").canOverride, false);
    assert.equal(blocked("MAINTAIN").canOverride, true);
    assert.equal(blocked("ADMIN").canOverride, true);
    // Conflicts can never be overridden.
    assert.equal(
      mergeReadiness(
        detail({ viewerPermission: "ADMIN", mergeable: "CONFLICTING" }),
      ).canOverride,
      false,
    );
  });

  it("selects a deterministic allowed merge method", () => {
    assert.equal(defaultMergeMethod(["rebase", "squash"]), "squash");
    assert.equal(defaultMergeMethod(["merge", "squash"]), "merge");
    assert.equal(defaultMergeMethod([]), undefined);
  });

  it("orders comments and reviews chronologically", () => {
    const conversation: GithubPrConversation = {
      body: "",
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
    };
    const timeline = prTimeline(conversation);
    assert.deepEqual(
      timeline.map((entry) => entry.kind),
      ["review", "comment"],
    );
  });

  it("formats relative dates", () => {
    const now = Date.parse("2026-08-22T12:00:00Z");
    assert.equal(formatRelativePrDate(undefined), "");
    assert.equal(formatRelativePrDate("2026-08-22T11:59:50Z", now), "just now");
    assert.equal(formatRelativePrDate("2026-08-22T11:35:00Z", now), "25m ago");
    assert.equal(formatRelativePrDate("2026-08-22T09:00:00Z", now), "3h ago");
    assert.equal(formatRelativePrDate("2026-08-19T12:00:00Z", now), "3d ago");
    assert.ok(formatRelativePrDate("2026-01-05T00:00:00Z", now).length > 0);
  });

  it("tints review surfaces and collapses long bodies", () => {
    assert.equal(reviewSurfaceClass("APPROVED"), "bg-success/8");
    assert.equal(reviewSurfaceClass("CHANGES_REQUESTED"), "bg-destructive/8");
    assert.equal(reviewSurfaceClass("COMMENTED"), "");
    assert.equal(shouldCollapseBody("short"), false);
    assert.equal(shouldCollapseBody("line\n".repeat(13)), false);
    assert.equal(shouldCollapseBody("line\n".repeat(14)), true);
  });

  it("sorts check runs failing first, then pending, then passed", () => {
    const runs = sortCheckRuns([
      { name: "beta", status: "COMPLETED" },
      { name: "gamma", status: "IN_PROGRESS" },
      { name: "alpha", status: "COMPLETED" },
      { name: "delta", status: "QUEUED" },
      { name: "eps", status: "FAILURE" },
    ]);
    assert.deepEqual(
      runs.map((run) => run.name),
      ["eps", "delta", "gamma", "alpha", "beta"],
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
