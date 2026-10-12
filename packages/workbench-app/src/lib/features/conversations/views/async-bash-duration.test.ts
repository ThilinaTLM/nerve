import assert from "node:assert/strict";
import { test } from "node:test";
import type { AsyncBash } from "@nervekit/contracts/core";
import { asyncBashDuration } from "./async-bash-duration";
const bash = {
  status: "completed",
  startedAt: "2026-01-01T00:00:00Z",
  finishedAt: "2026-01-01T00:00:03Z",
} as AsyncBash;
const now = Date.parse("2026-01-01T00:00:10Z");

test("elapsed uses now only for running commands and freezes terminal duration", () => {
  assert.equal(asyncBashDuration(bash, now), "3s");
  assert.equal(asyncBashDuration(bash, now + 10000), "3s");
  assert.equal(
    asyncBashDuration({ ...bash, status: "running", finishedAt: null }, now),
    "10s",
  );
  assert.equal(asyncBashDuration(undefined, now), undefined);
});

test("terminal missing or malformed timestamps and invalid clocks show unknown", () => {
  for (const status of [
    "completed",
    "failed",
    "cancelled",
    "lost",
    "timed_out",
  ] as const) {
    assert.equal(
      asyncBashDuration({ ...bash, status, finishedAt: null }, now),
      "Unknown duration",
    );
  }
  for (const patch of [
    { startedAt: "invalid" },
    { finishedAt: "invalid" },
    { finishedAt: "2025-01-01T00:00:00Z" },
  ]) {
    assert.equal(
      asyncBashDuration({ ...bash, ...patch }, now),
      "Unknown duration",
    );
  }
  assert.equal(
    asyncBashDuration({ ...bash, status: "running" }, NaN),
    "Unknown duration",
  );
});
