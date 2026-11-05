import assert from "node:assert/strict";
import { test } from "node:test";
import { createFakeClock, flush } from "./fake-clock";
import { createPoll, type PollEnvironment } from "./poll";

function setup(
  options: {
    enabled?: () => boolean;
    minGapMs?: number;
    intervalMs?: number;
    immediate?: boolean;
    run?: (signal: AbortSignal) => Promise<void> | void;
    onError?: (error: unknown) => void;
  } = {},
) {
  const fake = createFakeClock();
  let visible = true;
  let wake: (() => void) | undefined;
  const environment: PollEnvironment = {
    isVisible: () => visible,
    listen: (onChange) => {
      wake = onChange;
      return () => {
        wake = undefined;
      };
    },
  };
  const state = { runs: 0 };
  const poll = createPoll({
    intervalMs: options.intervalMs ?? 1000,
    clock: fake.clock,
    environment,
    onError: options.onError ?? (() => undefined),
    enabled: options.enabled,
    minGapMs: options.minGapMs,
    immediate: options.immediate,
    run: async (signal) => {
      state.runs += 1;
      await options.run?.(signal);
    },
  });
  return {
    fake,
    poll,
    state,
    setVisible(value: boolean) {
      visible = value;
      wake?.();
    },
    wake: () => wake?.(),
    hasListener: () => wake !== undefined,
  };
}

test("ticks on the interval and re-arms after each run", async () => {
  const h = setup();
  h.poll.start();
  await h.fake.advance(999);
  assert.equal(h.state.runs, 0);
  await h.fake.advance(1);
  assert.equal(h.state.runs, 1);
  await h.fake.advance(2000);
  assert.equal(h.state.runs, 3);
  h.poll.stop();
  await h.fake.advance(5000);
  assert.equal(h.state.runs, 3);
  assert.equal(h.hasListener(), false);
});

test("never overlaps slow runs and coalesces triggers into one follow-up", async () => {
  let release: (() => void) | undefined;
  let active = 0;
  let maxActive = 0;
  const h = setup({
    immediate: true,
    run: () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      return new Promise<void>((resolve) => {
        release = () => {
          active -= 1;
          resolve();
        };
      });
    },
  });
  h.poll.start();
  await flush();
  assert.equal(h.state.runs, 1);
  void h.poll.trigger();
  void h.poll.trigger();
  await h.fake.advance(5000); // timer is not armed while running
  assert.equal(h.state.runs, 1);
  release?.();
  await flush();
  assert.equal(h.state.runs, 2); // single follow-up
  release?.();
  await flush();
  assert.equal(h.state.runs, 2);
  assert.equal(maxActive, 1);
  h.poll.stop();
});

test("pauses while hidden and refreshes on visible when stale", async () => {
  const h = setup();
  h.poll.start();
  h.setVisible(false);
  await h.fake.advance(10_000);
  assert.equal(h.state.runs, 0);
  h.setVisible(true);
  await flush();
  assert.equal(h.state.runs, 1);
  // Visible again within the gap: no extra run, timer keeps ticking.
  await h.fake.advance(500);
  h.wake();
  await flush();
  assert.equal(h.state.runs, 1);
  await h.fake.advance(500);
  assert.equal(h.state.runs, 2);
  h.poll.stop();
});

test("minGapMs coalesces wake storms", async () => {
  const h = setup({ minGapMs: 60_000, intervalMs: 3_600_000 });
  h.poll.start();
  h.wake();
  await flush();
  assert.equal(h.state.runs, 1);
  await h.fake.advance(30_000);
  h.wake();
  await flush();
  assert.equal(h.state.runs, 1);
  await h.fake.advance(30_000);
  h.wake();
  await flush();
  assert.equal(h.state.runs, 2);
  h.poll.stop();
});

test("honors enabled and resumes on reschedule", async () => {
  let on = false;
  const h = setup({ enabled: () => on });
  h.poll.start();
  await h.fake.advance(5000);
  assert.equal(h.state.runs, 0);
  on = true;
  h.poll.reschedule();
  await h.fake.advance(1000);
  assert.equal(h.state.runs, 1);
  on = false;
  await h.fake.advance(5000);
  assert.equal(h.state.runs, 1);
  h.poll.stop();
});

test("reports errors, keeps polling, and aborts the signal on stop", async () => {
  const errors: unknown[] = [];
  let signal: AbortSignal | undefined;
  const h = setup({
    onError: (error) => errors.push(error),
    run: (s) => {
      signal = s;
      throw new Error("boom");
    },
  });
  h.poll.start();
  await h.fake.advance(2000);
  assert.equal(h.state.runs, 2);
  assert.equal(errors.length, 2);
  h.poll.stop();
  assert.equal(signal?.aborted, true);
});
