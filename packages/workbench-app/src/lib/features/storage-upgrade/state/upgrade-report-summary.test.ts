import assert from "node:assert/strict";
import { test } from "node:test";
import type { UpgradeReport } from "@nervekit/contracts/status";
import {
  summarizeUpgradeReports,
  upgradeReportHeadline,
  upgradeReportLosses,
  upgradeReportSetAsideGroups,
} from "./upgrade-report-summary";

const item = (kind: "conversation" | "configuration", id: string) => ({
  kind,
  id,
  reason: "bad",
  quarantinePath: `/q/${id}`,
});
const report = (over: Partial<UpgradeReport>): UpgradeReport => ({
  step: "0001-a",
  description: "",
  completedAt: "2026-01-01T00:00:00Z",
  setAside: [],
  losses: [],
  ...over,
});

test("summarizes set-aside conversations and settings", () => {
  assert.equal(
    summarizeUpgradeReports([
      report({
        setAside: [
          item("conversation", "a"),
          item("conversation", "b"),
          item("configuration", "c"),
        ],
      }),
    ]),
    "Upgrade complete: 2 conversations and 1 settings file were set aside because they couldn't be upgraded.",
  );
  assert.equal(
    summarizeUpgradeReports([
      report({ setAside: [item("conversation", "a")] }),
    ]),
    "Upgrade complete: 1 conversation was set aside because it couldn't be upgraded.",
  );
});

test("groups set-aside reasons with counts and bounded quarantine examples", () => {
  const reports = [
    report({
      setAside: Array.from({ length: 20 }, (_, i) => ({
        ...item("configuration", String(i)),
        reason: `/home/test/config/${i}.json: Invalid JSON`,
      })),
    }),
  ];
  assert.deepEqual(upgradeReportSetAsideGroups(reports), [
    {
      reason: "Invalid JSON",
      count: 20,
      paths: ["/q/0", "/q/1", "/q/2"],
    },
  ]);
});

test("describes loss-only reports and merges losses by reason", () => {
  const reports = [
    report({ losses: [{ reason: "missing asset", count: 2 }] }),
    report({
      step: "0002-b",
      losses: [
        { reason: "missing asset", count: 1 },
        { reason: "lossy", count: 4 },
      ],
    }),
  ];
  assert.equal(
    summarizeUpgradeReports(reports),
    "Upgrade complete: 7 items could not be fully upgraded.",
  );
  assert.deepEqual(upgradeReportLosses(reports), [
    { reason: "missing asset", count: 3 },
    { reason: "lossy", count: 4 },
  ]);
});

test("headline is a short title with a one-line description", () => {
  assert.deepEqual(
    upgradeReportHeadline([
      report({
        setAside: [item("configuration", "a"), item("configuration", "b")],
      }),
    ]),
    {
      title: "Upgrade finished with issues",
      description: "2 settings files couldn't be upgraded",
    },
  );
  assert.equal(upgradeReportHeadline([report({})]).title, "Upgrade finished");
});
