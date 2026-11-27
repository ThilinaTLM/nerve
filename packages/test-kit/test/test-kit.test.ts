import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import {
  createManualTimerCore,
  jsonResponse,
  makeTempDir,
  stubFetch,
  waitFor,
  waitForProcessExit,
} from "../src/index.ts";

function fakeContext() {
  const hooks: (() => void | Promise<void>)[] = [];
  return {
    t: { after: (fn: () => void | Promise<void>) => void hooks.push(fn) },
    finish: async () => {
      for (const hook of hooks.reverse()) await hook();
    },
  };
}

test("makeTempDir creates a directory removed by the after hook", async () => {
  const { t, finish } = fakeContext();
  const dir = await makeTempDir(t, "kit-");
  await writeFile(join(dir, "file"), "x");
  assert.ok(existsSync(dir));
  await finish();
  assert.equal(existsSync(dir), false);
});

test("waitFor returns the truthy value and reports the last error on timeout", async () => {
  let n = 0;
  assert.equal(await waitFor(() => (++n >= 3 ? "done" : false)), "done");
  await assert.rejects(
    waitFor(
      () => {
        throw new Error("probe failed");
      },
      { timeoutMs: 30, message: "thing" },
    ),
    (error: Error) =>
      /waiting for thing/.test(error.message) &&
      (error.cause as Error).message === "probe failed",
  );
});

test("waitForProcessExit resolves once the process is gone", async () => {
  const child = spawn(process.execPath, ["-e", "setTimeout(()=>{},50)"]);
  const exited = new Promise((resolve) => child.once("exit", resolve));
  await waitForProcessExit(child.pid as number);
  await exited;
});

test("manual timers fire in time order and honor clear and intervals", async () => {
  const timers = createManualTimerCore(100);
  const log: string[] = [];
  timers.setTimeout(() => log.push("b"), 20);
  timers.setTimeout(() => log.push("a"), 10);
  const cancelled = timers.setTimeout(() => log.push("x"), 5);
  timers.clearTimeout(cancelled);
  let ticks = 0;
  const interval = timers.setInterval(() => ticks++, 8);
  await timers.advance(25);
  assert.deepEqual(log, ["a", "b"]);
  assert.equal(ticks, 3);
  assert.equal(timers.now(), 125);
  timers.clearInterval(interval);
  assert.equal(timers.pending(), 0);
});

test("timers scheduled by a callback inside the window also fire", async () => {
  const timers = createManualTimerCore();
  const log: number[] = [];
  timers.setTimeout(() => {
    log.push(timers.now());
    timers.setTimeout(() => log.push(timers.now()), 5);
  }, 5);
  await timers.advance(20);
  assert.deepEqual(log, [5, 10]);
});

test("stubFetch records calls and restores fetch", async () => {
  const original = globalThis.fetch;
  const { t, finish } = fakeContext();
  const { calls } = stubFetch(t, () =>
    jsonResponse({ ok: true }, { status: 201 }),
  );
  const response = await fetch("/api/x", { method: "POST" });
  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), { ok: true });
  assert.equal(calls[0]?.url, "/api/x");
  assert.equal(calls[0]?.init?.method, "POST");
  await finish();
  assert.equal(globalThis.fetch, original);
});
