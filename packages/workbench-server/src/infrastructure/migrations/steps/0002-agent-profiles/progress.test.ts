import assert from "node:assert/strict";
import { setImmediate } from "node:timers/promises";
import { test } from "node:test";
import type { StepContext } from "../../framework/step.js";
import { phaseProgress } from "./progress.js";

void test("progress is bounded, reports exact endpoints, and lets polling run", async (t) => {
  let now = 0;
  t.mock.method(performance, "now", () => now);
  const reports: unknown[][] = [];
  const ctx = {
    progress: (...args: unknown[]) => reports.push(args),
  } as unknown as StepContext;
  const progress = phaseProgress(
    ctx,
    "conversations",
    "Applying conversation profiles",
    1000,
    true,
  );
  let polled = false;
  void setImmediate().then(() => {
    polled = true;
  });
  await progress();
  assert(
    polled,
    "must yield to lifecycle polling, not only promise microtasks",
  );
  for (let done = 1; done <= 1000; done++) {
    now = done;
    await progress(done);
  }
  assert.deepEqual(
    reports.map((report) => report[1]),
    [0, 250, 500, 750, 1000],
  );
  assert(reports.every((report) => report[2] === 1000));
});

void test("safety phases carry real counts without resetting the conversation meter", async () => {
  const reports: unknown[][] = [];
  const ctx = {
    progress: (...args: unknown[]) => reports.push(args),
  } as unknown as StepContext;
  const progress = phaseProgress(
    ctx,
    "verify-conversations",
    "Verifying conversation profiles",
    2,
  );
  await progress();
  await progress(2);
  assert.deepEqual(reports, [
    [
      "verify-conversations",
      undefined,
      undefined,
      "Verifying conversation profiles · 0 of 2",
    ],
    [
      "verify-conversations",
      undefined,
      undefined,
      "Verifying conversation profiles · 2 of 2",
    ],
  ]);
});
