import assert from "node:assert/strict";
import { test } from "node:test";
import { projectActivitySignal } from "./project-switcher.js";

test("pending async work alone has an unfinished blue project signal", () => {
  const signal = projectActivitySignal(
    { needsUser: 0, failed: 0, running: 0, awaitingAsync: 2 },
    { running: 0 },
  );
  assert.equal(signal?.tone, "info");
  assert.equal(signal?.count, 2);
  assert.equal(signal?.summary, "2 waiting for background work");
});

test("human action and failures outrank async work in project signals", () => {
  const activity = { needsUser: 1, failed: 1, running: 1, awaitingAsync: 1 };
  assert.equal(
    projectActivitySignal(activity, { running: 0 })?.tone,
    "warning",
  );
  assert.equal(
    projectActivitySignal({ ...activity, needsUser: 0 }, { running: 0 })?.tone,
    "destructive",
  );
});
