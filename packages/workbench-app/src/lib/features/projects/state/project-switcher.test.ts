import assert from "node:assert/strict";
import { test } from "node:test";
import type { ConversationSummary } from "@nervekit/contracts/core";
import { summaryActivity } from "$lib/presentation/conversations/conversation-activity";
import {
  projectActivitySignal,
  summarizeProjectActivity,
} from "./project-switcher.js";

test("pending async work alone has an unfinished blue project signal", () => {
  const signal = projectActivitySignal(
    { needsUser: 0, failed: 0, running: 0, awaitingAsync: 2, resultReady: 0 },
    { running: 0 },
  );
  assert.equal(signal?.tone, "info");
  assert.equal(signal?.count, 2);
  assert.equal(signal?.summary, "2 waiting for background work");
});

test("human action and failures outrank async work in project signals", () => {
  const activity = {
    needsUser: 1,
    failed: 1,
    running: 1,
    awaitingAsync: 1,
    resultReady: 0,
  };
  assert.equal(
    projectActivitySignal(activity, { running: 0 })?.tone,
    "warning",
  );
  assert.equal(
    projectActivitySignal({ ...activity, needsUser: 0 }, { running: 0 })?.tone,
    "destructive",
  );
});

test("project summary counts interrupted as failed and unseen results separately", () => {
  const row = (id: string, status: ConversationSummary["status"]) =>
    ({
      id,
      status,
      pendingWork: false,
      pendingInput: null,
    }) as ConversationSummary;
  const rows = [
    row("a", "interrupted"),
    row("b", "failed"),
    row("c", "idle"),
    row("d", "idle"),
  ];
  const activityById = {
    a: summaryActivity(rows[0]),
    b: summaryActivity(rows[1]),
    c: summaryActivity(rows[2], { resultReady: true }),
    d: summaryActivity(rows[3]),
  };
  assert.deepEqual(summarizeProjectActivity(rows, activityById), {
    needsUser: 0,
    failed: 2,
    running: 0,
    awaitingAsync: 0,
    resultReady: 1,
  });
});
