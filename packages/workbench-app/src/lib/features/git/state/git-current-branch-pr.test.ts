import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { GithubPr, GithubPrHeadSummary } from "@nervekit/contracts/git";
import {
  currentBranchPrHead,
  resolveCurrentBranchPr,
} from "./git-current-branch-pr.js";

function head(
  number: number,
  updatedAt: string,
  isDraft = false,
): GithubPrHeadSummary {
  return {
    number,
    updatedAt,
    isDraft,
    url: `https://github.com/o/r/pull/${number}`,
    headRefName: "feature",
    headRepository: "o/r",
  };
}
function pr(number: number): GithubPr {
  return {
    ...head(number, "2026-01-01"),
    title: "PR",
    state: "OPEN",
    baseRefName: "main",
    author: null,
    commentCount: 0,
    additions: 1,
    deletions: 0,
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

describe("current branch PR", () => {
  it("chooses the newest matching open head, including drafts, without mutating the input", () => {
    const heads = [
      head(1, "2026-01-01"),
      head(2, "2026-02-01", true),
      { ...head(3, "2026-03-01"), headRefName: "other" },
    ];
    assert.equal(currentBranchPrHead("feature", heads)?.number, 2);
    assert.equal(currentBranchPrHead("missing", heads), undefined);
    assert.equal(currentBranchPrHead(undefined, heads), undefined);
    assert.deepEqual(
      heads.map((entry) => entry.number),
      [1, 2, 3],
    );
  });

  it("reuses an exact loaded card and otherwise makes only one branch-filtered read", async () => {
    let calls = 0;
    const fetch = async () => {
      calls++;
      return [pr(2), pr(3)];
    };
    const loaded = pr(2);
    assert.equal(
      await resolveCurrentBranchPr(head(2, "2026-01-01"), [loaded], fetch),
      loaded,
    );
    assert.equal(calls, 0);
    assert.equal(
      (await resolveCurrentBranchPr(head(2, "2026-01-01"), [pr(1)], fetch))
        ?.number,
      2,
    );
    assert.equal(calls, 1);
    assert.equal(
      await resolveCurrentBranchPr(head(4, "2026-01-01"), [], fetch),
      undefined,
    );
    assert.equal(calls, 2);
  });

  it("does not reuse a closed card", async () => {
    assert.equal(
      await resolveCurrentBranchPr(
        head(1, "2026-01-01"),
        [{ ...pr(1), state: "MERGED" }],
        async () => [],
      ),
      undefined,
    );
  });
});
