import assert from "node:assert/strict";
import { test } from "node:test";
import { createManualTimerCore, flush } from "@nervekit/test-kit";
import {
  parseLaunchWait,
  waitForLaunchOutput,
  type LaunchWaitClock,
} from "./launch-wait.js";
import type { LaunchRun } from "./launches-port.js";
import { launchesMethods } from "./launches-methods.js";
import type { SdkEnvironment } from "../sdk-types.js";

const run = (fields: Partial<LaunchRun> = {}): LaunchRun => ({
  runId: "launch_one",
  name: "web",
  command: "pnpm dev",
  status: "running",
  startedAt: "2026-01-01T00:00:00Z",
  ...fields,
});

/** A log that grows by one entry of `steps` per read; the last repeats. */
function fakePort(
  steps: { status?: string; exitCode?: number; text: string }[],
) {
  let reads = 0;
  return {
    get reads() {
      return reads;
    },
    async readOutput() {
      const step = steps[Math.min(reads++, steps.length - 1)];
      return {
        run: run({ status: step.status ?? "running", exitCode: step.exitCode }),
        text: step.text,
      };
    },
  };
}

function manualClock() {
  const timers = createManualTimerCore();
  const clock: LaunchWaitClock = {
    now: () => timers.now(),
    sleep: (ms, signal) =>
      new Promise((resolve, reject) => {
        if (signal?.aborted) return reject(signal.reason);
        const handle = timers.setTimeout(resolve, ms);
        signal?.addEventListener("abort", () => {
          timers.clearTimeout(handle);
          reject(signal.reason);
        });
      }),
  };
  return { timers, clock };
}

const seconds = (n: number) => ({ pattern: "x", timeoutMs: n * 1000 });

void test("returns the tail up to the matching line once the output matches", async () => {
  const { timers, clock } = manualClock();
  const port = fakePort([
    { text: "boot\n" },
    { text: "boot\nlistening on 3000\nlater line\n" },
  ]);
  const pending = waitForLaunchOutput(
    port,
    "launch_one",
    { pattern: /listening on \d+/, timeoutMs: 60_000 },
    undefined,
    clock,
  );
  await flush();
  await timers.advance(250);
  const result = await pending;
  assert.equal(result.matched, true);
  assert.equal(result.output, "boot\nlistening on 3000");
});

void test("a string is a literal substring; a RegExp is a pattern", async () => {
  const text = "a.b\naxb\n";
  const literal = await waitForLaunchOutput(fakePort([{ text }]), "r", {
    pattern: "a.b",
    timeoutMs: 1000,
  });
  assert.equal(literal.output, "a.b");
  const pattern = await waitForLaunchOutput(fakePort([{ text }]), "r", {
    pattern: /a.b$/gm,
    timeoutMs: 1000,
  });
  assert.equal(pattern.output, "a.b");
  const second = await waitForLaunchOutput(
    fakePort([{ text: "x\nfoo\n" }]),
    "r",
    { pattern: /foo/g, timeoutMs: 1000 },
  );
  assert.equal(second.matched, true);
});

void test("the tail is at most 100 lines", async () => {
  const text = `${Array.from({ length: 150 }, (_, i) => `l${i}`).join("\n")}\n`;
  const result = await waitForLaunchOutput(fakePort([{ text }]), "r", {
    pattern: "l120",
    timeoutMs: 1000,
  });
  const lines = result.output.split("\n");
  assert.equal(lines.length, 100);
  assert.equal(lines.at(-1), "l120");
});

void test("a run that exits before matching returns its final state and tail", async () => {
  const port = fakePort([{ status: "failed", exitCode: 1, text: "boom\n" }]);
  const result = await waitForLaunchOutput(port, "r", seconds(60));
  assert.equal(result.matched, false);
  assert.equal(result.run.status, "failed");
  assert.equal(result.run.exitCode, 1);
  assert.equal(result.output, "boom");
});

void test("a timeout is a result, not an error", async () => {
  const { timers, clock } = manualClock();
  const port = fakePort([{ text: "still booting\n" }]);
  const pending = waitForLaunchOutput(port, "r", seconds(1), undefined, clock);
  for (let i = 0; i < 4; i++) {
    await flush();
    await timers.advance(250);
  }
  const result = await pending;
  assert.equal(result.matched, false);
  assert.equal(result.output, "still booting");
  assert.equal(result.run.status, "running");
  assert.equal(port.reads, 5);
});

void test("an abort stops the wait immediately", async () => {
  const { clock } = manualClock();
  const controller = new AbortController();
  const port = fakePort([{ text: "" }]);
  const pending = waitForLaunchOutput(
    port,
    "r",
    seconds(60),
    controller.signal,
    clock,
  );
  await Promise.resolve();
  controller.abort(new Error("cancelled"));
  await assert.rejects(pending, /cancelled/);
});

void test("invalid waitFor and timeout name the field and the valid values", () => {
  assert.throws(() => parseLaunchWait({ waitFor: "" }), /waitFor must be/);
  assert.throws(() => parseLaunchWait({ waitFor: 3 }), /waitFor must be/);
  assert.throws(
    () => parseLaunchWait({ waitFor: { source: "(", flags: "" } }),
    /waitFor is not a valid regular expression/,
  );
  for (const timeout of [0, -1, 601, "5", Number.NaN])
    assert.throws(
      () => parseLaunchWait({ waitFor: "x", timeout }),
      /timeout must be a number of seconds from above 0 to 600/,
    );
  assert.throws(
    () => parseLaunchWait({ timeout: 5 }),
    /only applies with waitFor/,
  );
  assert.equal(parseLaunchWait({}), undefined);
  assert.deepEqual(parseLaunchWait({ waitFor: "x" }), {
    pattern: "x",
    timeoutMs: 60_000,
  });
  const bridged = parseLaunchWait({
    waitFor: { source: "a+", flags: "i" },
    timeout: 2,
  });
  assert.ok(bridged?.pattern instanceof RegExp);
  assert.equal(bridged.timeoutMs, 2000);
});

void test("start waits on the started run; logs rejects paging with waitFor", async () => {
  const port = {
    prepareStart: async () => ({
      name: "web",
      process: { command: "pnpm dev" },
      start: async () => ({
        ...run({ status: "starting" }),
        outcome: "started" as const,
      }),
    }),
    logs: async () => ({ run: run(), output: "ignored" }),
    readOutput: async () => ({
      run: run({ status: "ready" }),
      text: "old\nready now\n",
    }),
  };
  const env = {
    context: { launchesAgent: port },
  } as unknown as SdkEnvironment;
  const method = (path: string) =>
    launchesMethods.find((item) => item.path === path)!;
  const prepared = await method("start").prepare(
    [{ name: "web", waitFor: { source: "ready", flags: "" } }],
    env,
  );
  assert.deepEqual(await prepared.run(env), {
    ...run({ status: "ready" }),
    outcome: "started",
    matched: true,
    output: "old\nready now",
  });
  await assert.rejects(
    method("logs").prepare([{ name: "web", waitFor: "x", lines: 5 }], env),
    /do not combine with waitFor/,
  );
  const logs = await method("logs").prepare(
    [{ name: "web", waitFor: "now" }],
    env,
  );
  assert.deepEqual(await logs.run(env), {
    run: run({ status: "ready" }),
    output: "old\nready now",
    matched: true,
  });
});
