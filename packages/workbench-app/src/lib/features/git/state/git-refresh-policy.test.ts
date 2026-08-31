import type { GithubPr } from "@nervekit/contracts/git";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  githubPrFiltersFingerprint,
  isFresh,
  pendingPollTargets,
} from "./git-refresh-policy.js";

const pendingPr = (number: number): GithubPr => ({
  number,
  title: `PR ${number}`,
  url: `https://example.test/${number}`,
  state: "OPEN",
  isDraft: false,
  headRefName: `feature-${number}`,
  baseRefName: "main",
  updatedAt: "2026-07-30T00:00:00Z",
  checks: {
    status: "pending",
    total: 1,
    passed: 0,
    failed: 0,
    pending: 1,
    runs: [],
  },
});

describe("git refresh policy", () => {
  it("uses strict freshness boundaries", () => {
    assert.equal(isFresh(1_000, 1_999, 1_000), true);
    assert.equal(isFresh(1_000, 2_000, 1_000), false);
    assert.equal(isFresh(undefined, 2_000, 1_000), false);
  });

  it("normalizes label order in PR filter cache keys", () => {
    const base = {
      author: "any" as const,
      drafts: "include" as const,
      title: "",
      labels: ["bug", "ui"],
      sort: "updated-desc" as const,
    };
    assert.equal(
      githubPrFiltersFingerprint(base),
      githubPrFiltersFingerprint({ ...base, labels: ["ui", "bug"] }),
    );
  });

  it("avoids list polling when the active detail is the only pending PR", () => {
    assert.deepEqual(
      pendingPollTargets({
        visible: true,
        prs: [pendingPr(1)],
        activePrNumber: 1,
        activePrPending: true,
      }),
      { pollActiveDetail: true, pollList: false },
    );
    assert.deepEqual(
      pendingPollTargets({
        visible: true,
        prs: [pendingPr(1), pendingPr(2)],
        activePrNumber: 1,
        activePrPending: true,
      }),
      { pollActiveDetail: true, pollList: true },
    );
  });

  it("does not poll while hidden", () => {
    assert.deepEqual(
      pendingPollTargets({
        visible: false,
        prs: [pendingPr(1)],
        activePrPending: true,
      }),
      { pollActiveDetail: false, pollList: false },
    );
  });
});
