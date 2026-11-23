import assert from "node:assert/strict";
import test from "node:test";
import { createPresenceReporter } from "./presence-reporter";

test("sends only changes, and repeats when forced", () => {
  const sent: unknown[] = [];
  const reporter = createPresenceReporter(async (p) => sent.push(p));
  reporter.sync({ active: true, muted: false });
  reporter.sync({ active: true, muted: false });
  reporter.sync({ active: false, muted: false });
  reporter.sync({ active: false, muted: true });
  assert.equal(sent.length, 3);
  reporter.sync({ active: false, muted: true }, true);
  assert.equal(sent.length, 4);
});

test("a failed send is retried on the next sync", async () => {
  let fail = true;
  let calls = 0;
  const reporter = createPresenceReporter(async () => {
    calls++;
    if (fail) throw new Error("down");
  });
  reporter.sync({ active: true, muted: false });
  await new Promise((resolve) => setTimeout(resolve, 0));
  fail = false;
  reporter.sync({ active: true, muted: false });
  assert.equal(calls, 2);
});
