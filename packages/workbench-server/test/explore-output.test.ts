import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatExploreReports } from "../src/domains/agents/run/explore-helpers.js";
import type { ExploreReport } from "../src/domains/agents/run/subagent-runner.js";

function report(index: number, body: string): ExploreReport {
  return {
    agentId: `agent_01H0000000000000000000000${index}`,
    task: `Investigate subsystem ${index} in detail`,
    label: `subsystem-${index}`,
    status: "completed",
    report: body,
    reportPath: `/tmp/nerve/explore/report-${index}.md`,
    summaryPreview: `Summary ${index}`,
  };
}

describe("explore model output", () => {
  it("starts with a recovery index for every report before full excerpts", () => {
    const output = formatExploreReports([
      report(1, "first full report ".repeat(600)),
      report(2, "second full report ".repeat(600)),
    ]);

    const firstHeading = output.indexOf("# Explore report 1:");
    assert.ok(firstHeading > 0);
    const index = output.slice(0, firstHeading);
    assert.match(index, /subsystem-1/);
    assert.match(index, /Summary 1/);
    assert.match(index, /report-1\.md/);
    assert.match(index, /subsystem-2/);
    assert.match(index, /Summary 2/);
    assert.match(index, /report-2\.md/);
    assert.match(output.slice(firstHeading), /first full report/);
  });
});
