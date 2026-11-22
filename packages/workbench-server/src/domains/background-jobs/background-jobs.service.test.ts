import assert from "node:assert/strict";
import { test } from "node:test";
import { BackgroundJobNotices } from "./background-job-notices.js";
import {
  BackgroundJobService,
  type BackgroundJobClock,
  type BackgroundJobDefinition,
} from "./background-jobs.service.js";

class FakeClock implements BackgroundJobClock {
  time = 1_000_000;
  #timers = new Map<
    number,
    { at: number; every?: number; callback: () => void }
  >();
  #next = 0;
  now = () => this.time;
  setInterval = (callback: () => void, ms: number) =>
    this.#add({ at: this.time + ms, every: ms, callback });
  setTimeout = (callback: () => void, ms: number) =>
    this.#add({ at: this.time + ms, callback });
  #add(timer: { at: number; every?: number; callback: () => void }) {
    const id = this.#next++;
    this.#timers.set(id, timer);
    return () => void this.#timers.delete(id);
  }
  /** Moves time forward, firing due timers in order and letting promises settle. */
  async advance(ms: number): Promise<void> {
    const end = this.time + ms;
    for (;;) {
      const due = [...this.#timers.entries()]
        .filter(([, timer]) => timer.at <= end)
        .sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      const [id, timer] = due;
      this.time = Math.max(this.time, timer.at);
      if (timer.every) timer.at += timer.every;
      else this.#timers.delete(id);
      timer.callback();
      await settle();
    }
    this.time = end;
    await settle();
  }
  /** Wall clock jumps (sleep) without firing timers in between. */
  jump(ms: number): void {
    this.time += ms;
    for (const timer of this.#timers.values())
      if (timer.every) timer.at = Math.min(timer.at, this.time);
  }
}

const settle = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};
const MIN = 60_000;

function job(
  id: string,
  run: BackgroundJobDefinition["run"],
  overrides: Partial<BackgroundJobDefinition> = {},
): BackgroundJobDefinition {
  return {
    id,
    label: id,
    description: "",
    intervalMs: 5 * MIN,
    timeoutMs: MIN,
    run,
    ...overrides,
  };
}

void test("runs on the first tick, then every interval", async () => {
  const clock = new FakeClock();
  const service = new BackgroundJobService({ clock });
  let runs = 0;
  service.register(job("a", () => `run ${++runs}`));
  service.start();
  await settle();
  assert.equal(runs, 1);
  assert.equal(service.list()[0].lastRun?.outcome.ok, true);
  await clock.advance(4 * MIN);
  assert.equal(runs, 1);
  await clock.advance(MIN);
  assert.equal(runs, 2);
  assert.equal(service.list()[0].status, "idle");
});

void test("a sleep runs a job once, not once per missed interval", async () => {
  const clock = new FakeClock();
  const service = new BackgroundJobService({ clock });
  let runs = 0;
  service.register(job("a", () => `run ${++runs}`));
  service.start();
  await settle();
  clock.jump(3 * 60 * MIN);
  await clock.advance(30_000);
  assert.equal(runs, 2);
  await clock.advance(MIN);
  assert.equal(runs, 2);
});

void test("failures back off exponentially up to the interval and reset on success", async () => {
  const clock = new FakeClock();
  const service = new BackgroundJobService({ clock });
  let fail = true;
  const starts: number[] = [];
  service.register(
    job(
      "a",
      () => {
        starts.push(clock.time);
        if (fail) throw new Error("boom");
        return "ok";
      },
      { intervalMs: 5 * MIN },
    ),
  );
  service.start();
  await clock.advance(30 * MIN);
  const gaps = starts.slice(1).map((time, i) => time - starts[i]);
  assert.deepEqual(
    gaps.slice(0, 5),
    [30_000, 60_000, 120_000, 240_000, 300_000],
  );
  assert.ok(gaps.every((gap) => gap <= 5 * MIN + 30_000));
  const state = service.list()[0];
  assert.equal(state.status, "failing");
  assert.deepEqual(state.lastRun?.outcome, { ok: false, error: "boom" });
  fail = false;
  await clock.advance(5 * MIN + 30_000);
  assert.equal(service.list()[0].status, "idle");
  const afterSuccess = starts.length;
  await clock.advance(MIN);
  assert.equal(starts.length, afterSuccess, "interval applies again");
});

void test("a job never overlaps itself and jobs run one after another", async () => {
  const clock = new FakeClock();
  const service = new BackgroundJobService({ clock });
  const log: string[] = [];
  const gates: Array<() => void> = [];
  const slow = (id: string) =>
    job(
      id,
      async () => {
        log.push(`start ${id}`);
        await new Promise<void>((resolve) => gates.push(resolve));
        log.push(`end ${id}`);
        return id;
      },
      { timeoutMs: 60 * MIN },
    );
  service.register(slow("a"));
  service.register(slow("b"));
  service.start();
  await settle();
  assert.deepEqual(log, ["start a"]);
  assert.equal(service.runNow("a").status, "running");
  await clock.advance(10 * MIN);
  assert.deepEqual(log, ["start a"], "still running, not started twice");
  gates.shift()!();
  await settle();
  assert.deepEqual(log, ["start a", "end a", "start b"]);
  gates.shift()!();
  await settle();
  assert.deepEqual(log.slice(3), ["end b"]);
});

void test("a run that exceeds its timeout is aborted and counts as a failure", async () => {
  const clock = new FakeClock();
  const service = new BackgroundJobService({ clock });
  let aborted = false;
  service.register(
    job(
      "a",
      (signal) =>
        new Promise<string>(() => {
          signal.addEventListener("abort", () => (aborted = true));
        }),
      { timeoutMs: MIN },
    ),
  );
  service.start();
  await clock.advance(MIN);
  assert.equal(aborted, true);
  const state = service.list()[0];
  assert.equal(state.status, "failing");
  assert.deepEqual(state.lastRun?.outcome, {
    ok: false,
    error: "Timed out after 1 min",
  });
});

void test("stop prevents new runs, aborts the running one and waits a bounded time", async () => {
  const clock = new FakeClock();
  const service = new BackgroundJobService({ clock, shutdownGraceMs: 5_000 });
  let aborted = false;
  let runsOfB = 0;
  service.register(
    job(
      "a",
      (signal) =>
        new Promise<string>(() =>
          signal.addEventListener("abort", () => (aborted = true)),
        ),
    ),
  );
  service.register(job("b", () => `${++runsOfB}`));
  service.start();
  await settle();
  const stopped = service.stop();
  await settle();
  assert.equal(aborted, true);
  await clock.advance(5_000);
  await stopped;
  await clock.advance(10 * MIN);
  assert.equal(runsOfB, 0);
  assert.throws(() => service.runNow("b"));
});

void test("a job failing three times shows a notice that the next success clears", async () => {
  const clock = new FakeClock();
  const reported: string[] = [];
  const removed: string[] = [];
  const notices = new BackgroundJobNotices({
    reportNotice: (input) => void reported.push(input.title),
    removeNotice: (id) => void removed.push(id),
  });
  const service = new BackgroundJobService({
    clock,
    onOutcome: notices.jobOutcome,
  });
  let fail = true;
  service.register(
    job("a", () => {
      if (fail) throw new Error("boom");
      return "fine";
    }),
  );
  service.start();
  await settle();
  await clock.advance(60_000);
  assert.deepEqual(reported, []);
  await clock.advance(30_000);
  assert.deepEqual(reported, ["a keeps failing"]);
  fail = false;
  await clock.advance(5 * MIN);
  assert.equal(removed.length, 1);
});
