import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { GithubChecksSummary } from "@nervekit/shared";
import { hasPendingPrChecks, isGithubChecksPending } from "./checks";

function checks(status: GithubChecksSummary["status"]): GithubChecksSummary {
  return {
    status,
    total: status === "none" ? 0 : 1,
    passed: status === "passing" ? 1 : 0,
    failed: status === "failing" ? 1 : 0,
    pending: status === "pending" ? 1 : 0,
    runs: [],
  };
}

describe("isGithubChecksPending", () => {
  it("detects pending check summaries", () => {
    assert.equal(isGithubChecksPending(checks("pending")), true);
    assert.equal(isGithubChecksPending(checks("passing")), false);
    assert.equal(isGithubChecksPending(undefined), false);
  });
});

describe("hasPendingPrChecks", () => {
  it("returns false for an empty PR list", () => {
    assert.equal(hasPendingPrChecks([]), false);
  });

  it("returns false when PR checks are terminal or absent", () => {
    assert.equal(
      hasPendingPrChecks([
        { checks: checks("passing") },
        { checks: checks("failing") },
        { checks: checks("none") },
      ]),
      false,
    );
  });

  it("returns true when any PR has pending checks", () => {
    assert.equal(
      hasPendingPrChecks([
        { checks: checks("passing") },
        { checks: checks("pending") },
      ]),
      true,
    );
  });
});
