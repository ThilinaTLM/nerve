import assert from "node:assert/strict";
import { test } from "node:test";
import type { BackgroundJob } from "@nervekit/contracts/background-jobs";
import { formatJobTime, jobRunLine } from "./background-jobs-format";

const now = Date.parse("2026-01-01T12:00:00Z");
const base: BackgroundJob = {
  id: "a",
  label: "A",
  description: "",
  intervalMs: 300_000,
  status: "idle",
};

void test("job times read relative to now", () => {
  assert.equal(formatJobTime("2026-01-01T12:04:00Z", now), "in 4 min");
  assert.equal(formatJobTime("2026-01-01T09:59:00Z", now), "2 h ago");
  assert.equal(formatJobTime("2026-01-01T12:00:10Z", now), "in under a minute");
  assert.equal(formatJobTime("2026-01-01T12:00:10Z", now, true), "just now");
});

void test("the run line shows the last summary and the next run", () => {
  assert.equal(jobRunLine(base, now), "Not run yet");
  assert.equal(
    jobRunLine(
      {
        ...base,
        lastRun: {
          startedAt: "2026-01-01T11:55:00Z",
          durationMs: 10,
          outcome: { ok: true, summary: "Refreshed 2 accounts" },
        },
        nextRun: "2026-01-01T12:05:00Z",
      },
      now,
    ),
    "Last run 5 min ago: Refreshed 2 accounts · Next run in 5 min",
  );
  assert.equal(jobRunLine({ ...base, status: "running" }, now), "Running now");
});
