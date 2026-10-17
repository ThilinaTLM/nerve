import assert from "node:assert/strict";
import test from "node:test";
import type { UpgradeReport } from "@nervekit/contracts/status";
import { dismissUpgradeReport } from "../api/upgrade-reports.api";
import { dismissVisibleUpgradeReports } from "./upgrade-report-dismissal";

const report = (step: string): UpgradeReport => ({
  step,
  description: "Upgrade",
  completedAt: "2026-01-01T00:00:00Z",
  setAside: [],
  losses: [{ reason: "Unreadable record", count: 1 }],
});

test("failed dismissal API retains reports; retry removes only persisted dismissals", async () => {
  const original = globalThis.fetch;
  const state = { reports: [report("failed"), report("succeeded")] };
  const errors: unknown[] = [];
  let failing = true;
  globalThis.fetch = (async (url) =>
    String(url).includes("failed") && failing
      ? Response.json(
          { error: { message: "Could not persist dismissal" } },
          { status: 500 },
        )
      : Response.json({ ok: true })) as typeof fetch;
  try {
    await dismissVisibleUpgradeReports(state, dismissUpgradeReport, (error) =>
      errors.push(error),
    );
    assert.deepEqual(
      state.reports.map((item) => item.step),
      ["failed"],
    );
    assert.equal(errors.length, 1);
    assert.match(String(errors[0]), /Could not persist dismissal/);
    failing = false;
    await dismissVisibleUpgradeReports(state, dismissUpgradeReport, (error) =>
      errors.push(error),
    );
    assert.deepEqual(state.reports, []);
  } finally {
    globalThis.fetch = original;
  }
});
