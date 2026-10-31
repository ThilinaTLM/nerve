import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  checkRunGroup,
  checkRunSeconds,
  formatCheckDuration,
  summarizeCheckRuns,
} from "./github-pr-checks.js";

const run = (status: string, extra: Record<string, unknown> = {}) => ({
  name: status,
  status,
  conclusion: status,
  ...extra,
});

describe("check runs", () => {
  it("buckets runs into display groups", () => {
    assert.deepEqual(
      ["failure", "in_progress", "queued", "pending", "success", "skipped"].map(
        (status) => checkRunGroup({ status }),
      ),
      ["failed", "running", "queued", "queued", "passed", "skipped"],
    );
  });

  it("summarizes health and required checks that are not passing", () => {
    const summary = summarizeCheckRuns([
      run("failure", { required: true }),
      run("in_progress", { required: true }),
      run("success", { required: true }),
      run("skipped"),
    ]);
    assert.equal(summary.headline, "1 check failing");
    assert.equal(summary.complete, 3);
    assert.equal(summary.requiredNotPassing, 2);
    assert.equal(
      summarizeCheckRuns([run("queued")]).headline,
      "1 check running",
    );
    assert.equal(
      summarizeCheckRuns([run("success")]).headline,
      "All checks passed",
    );
  });

  it("measures finished and running durations", () => {
    const now = Date.parse("2026-07-30T12:01:00Z");
    assert.equal(
      checkRunSeconds(
        {
          startedAt: "2026-07-30T12:00:00Z",
          completedAt: "2026-07-30T12:00:42Z",
        },
        now,
      ),
      42,
    );
    assert.equal(
      checkRunSeconds({ startedAt: "2026-07-30T12:00:00Z" }, now),
      60,
    );
    assert.equal(checkRunSeconds({}, now), undefined);
    assert.equal(formatCheckDuration(125), "2m 05s");
    assert.equal(formatCheckDuration(9), "9s");
  });
});
