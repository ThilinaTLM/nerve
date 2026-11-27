import assert from "node:assert/strict";
import { test } from "node:test";
import { sleep } from "../src/index.ts";

test("resolves after the delay", async () => {
  const start = Date.now();
  await sleep(20);
  assert.ok(Date.now() - start >= 15);
});

test("abort rejects with an AbortError and stops waiting", async () => {
  const controller = new AbortController();
  const waiting = sleep(60_000, controller.signal);
  controller.abort();
  await assert.rejects(waiting, { name: "AbortError" });
});

test("an already-aborted signal rejects with its reason", async () => {
  const reason = new Error("custom");
  await assert.rejects(sleep(60_000, AbortSignal.abort(reason)), reason);
});
