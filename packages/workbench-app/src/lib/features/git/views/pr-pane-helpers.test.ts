import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { GithubPrConversation } from "@nervekit/contracts/git";
import {
  defaultMergeMethod,
  formatCompactAge,
  fileStatusLetter,
  groupCommitsByDay,
  mergeAvailability,
  mergeReadiness,
  type MergeReadinessInput,
  prReviewers,
  prTimeline,
} from "./pr-pane-helpers.js";

function detail(
  overrides: Partial<MergeReadinessInput> = {},
): MergeReadinessInput {
  return {
    state: "OPEN",
    isDraft: false,
    headRefOid: "head1234567",
    mergeable: "MERGEABLE",
    mergeStateStatus: "CLEAN",
    reviewDecision: "APPROVED",
    mergeSettings: { allowedMethods: ["merge", "squash"] },
    checks: { status: "passing" },
    ...overrides,
  };
}

describe("PR pane helpers", () => {
  it("derives merge readiness and known blockers", () => {
    assert.equal(mergeReadiness(detail()).status, "ready");
    const blocked = mergeReadiness(
      detail({
        mergeStateStatus: "BEHIND",
        reviewDecision: "CHANGES_REQUESTED",
        checks: { status: "failing" },
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

  it("formats file statuses", () => {
    assert.equal(fileStatusLetter("renamed"), "R");
    assert.equal(fileStatusLetter("modified"), "M");
  });
});

describe("compact age", () => {
  const now = Date.parse("2026-07-30T12:00:00Z");
  it("scales the unit with the elapsed time", () => {
    assert.equal(formatCompactAge("2026-07-30T11:59:30Z", now), "now");
    assert.equal(formatCompactAge("2026-07-30T11:20:00Z", now), "40m");
    assert.equal(formatCompactAge("2026-07-30T04:00:00Z", now), "8h");
    assert.equal(formatCompactAge("2026-07-24T12:00:00Z", now), "6d");
    assert.equal(formatCompactAge("2026-05-01T12:00:00Z", now), "3mo");
    assert.equal(formatCompactAge("2023-05-01T12:00:00Z", now), "3y");
  });

  it("returns nothing for missing or unparsable timestamps", () => {
    assert.equal(formatCompactAge(undefined, now), "");
    assert.equal(formatCompactAge("not-a-date", now), "");
  });
});

describe("merge availability", () => {
  it("separates transient waiting from blockers", () => {
    assert.equal(mergeAvailability(mergeReadiness(detail())).kind, "ready");
    const running = mergeAvailability(
      mergeReadiness(
        detail({
          checks: { status: "pending" },
        }),
      ),
    );
    assert.deepEqual(running, {
      kind: "waiting",
      reason: "Checks are still running",
    });
    assert.equal(
      mergeAvailability(mergeReadiness(detail({ mergeable: "CONFLICTING" })))
        .kind,
      "blocked",
    );
  });
});

describe("reviewers", () => {
  it("keeps the latest decisive review and appends awaited reviewers", () => {
    const review = (author: string, state: string, at: string) => ({
      id: `${author}${at}`,
      author,
      state,
      body: "",
      submittedAt: at,
    });
    const reviewers = prReviewers(
      {
        reviews: [
          review("a", "CHANGES_REQUESTED", "2026-07-20T00:00:00Z"),
          review("a", "APPROVED", "2026-07-21T00:00:00Z"),
          review("a", "COMMENTED", "2026-07-22T00:00:00Z"),
          review("b", "COMMENTED", "2026-07-22T00:00:00Z"),
          review("octocat", "APPROVED", "2026-07-22T00:00:00Z"),
        ],
      },
      { reviewRequests: [{ login: "b" }, { login: "c" }] },
      "octocat",
    );
    assert.deepEqual(reviewers, [
      { login: "a", state: "approved" },
      { login: "b", state: "commented" },
      { login: "c", state: "requested" },
    ]);
  });
});

describe("commit days", () => {
  it("groups consecutive commits by local day", () => {
    const now = Date.parse("2026-07-30T12:00:00");
    const groups = groupCommitsByDay(
      [
        { authoredDate: "2026-07-29T09:00:00" },
        { authoredDate: "2026-07-30T08:00:00" },
        { authoredDate: "2026-07-30T10:00:00" },
      ],
      now,
    );
    assert.deepEqual(
      groups.map((group) => [group.day, group.commits.length]),
      [
        ["Yesterday", 1],
        ["Today", 2],
      ],
    );
  });
});
