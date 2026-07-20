import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { GithubPr } from "@nervekit/contracts";
import {
  activeGitPrFilterCount,
  defaultGitPrFilterConfig,
  hasActiveGitPrFilters,
  limitPullRequests,
  normalizeGitPrFilterConfig,
} from "./git-panel-controller.js";

function pr(number: number): GithubPr {
  return {
    number,
    title: `PR ${number}`,
    url: `https://example.test/${number}`,
    state: "OPEN",
    isDraft: false,
    headRefName: `branch-${number}`,
    baseRefName: "main",
    updatedAt: new Date(number * 1_000).toISOString(),
    checks: {
      status: "none",
      total: 0,
      passed: 0,
      failed: 0,
      pending: 0,
      runs: [],
    },
  };
}

describe("Git PR filter config", () => {
  it("normalizes text and exact labels", () => {
    const normalized = normalizeGitPrFilterConfig({
      ...defaultGitPrFilterConfig,
      author: "username",
      username: " octocat ",
      title: " windows ",
      labels: [" bug ", "bug", "", "needs-review"],
    });
    assert.equal(normalized.username, "octocat");
    assert.equal(normalized.title, "windows");
    assert.deepEqual(normalized.labels, ["bug", "needs-review"]);
    assert.equal(hasActiveGitPrFilters(normalized), true);
    assert.equal(activeGitPrFilterCount(normalized), 4);
    assert.equal(hasActiveGitPrFilters(defaultGitPrFilterConfig), false);
    assert.equal(activeGitPrFilterCount(defaultGitPrFilterConfig), 0);
    assert.equal(
      activeGitPrFilterCount({
        ...defaultGitPrFilterConfig,
        sort: "updated-asc",
      }),
      0,
    );
  });

  it("caps results at 10 without changing server order", () => {
    const input = Array.from({ length: 12 }, (_, index) => pr(12 - index));
    assert.deepEqual(
      limitPullRequests(input).map((item) => item.number),
      [12, 11, 10, 9, 8, 7, 6, 5, 4, 3],
    );
  });
});
