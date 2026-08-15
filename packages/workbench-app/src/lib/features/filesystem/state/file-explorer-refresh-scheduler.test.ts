import assert from "node:assert/strict";
import { test } from "node:test";
import { startFileExplorerRefreshScheduler } from "./file-explorer-refresh-scheduler";

type Timer = { at: number; callback: () => void; cancelled: boolean };

function schedulerHarness(
  refresh: () => void | Promise<void> = () => undefined,
) {
  const windowTarget = new EventTarget();
  const documentTarget = new EventTarget();
  const timers: Timer[] = [];
  let interval: (() => void) | undefined;
  let intervalMs: number | undefined;
  let intervalCleared = false;
  let visible = true;
  let now = 0;

  const scheduler = startFileExplorerRefreshScheduler({
    refresh,
    now: () => now,
    window: {
      addEventListener: windowTarget.addEventListener.bind(windowTarget),
      removeEventListener: windowTarget.removeEventListener.bind(windowTarget),
      setInterval: ((callback: TimerHandler, delay?: number) => {
        interval = callback as () => void;
        intervalMs = delay;
        return 1;
      }) as Window["setInterval"],
      clearInterval: (() => {
        intervalCleared = true;
      }) as Window["clearInterval"],
      setTimeout: ((callback: TimerHandler, delay?: number) => {
        const timer = {
          at: now + (delay ?? 0),
          callback: callback as () => void,
          cancelled: false,
        };
        timers.push(timer);
        return timer as unknown as number;
      }) as Window["setTimeout"],
      clearTimeout: ((timer: number) => {
        (timer as unknown as Timer).cancelled = true;
      }) as Window["clearTimeout"],
    },
    document: {
      addEventListener: documentTarget.addEventListener.bind(documentTarget),
      removeEventListener:
        documentTarget.removeEventListener.bind(documentTarget),
      get visibilityState() {
        return visible ? "visible" : "hidden";
      },
    },
  });

  const advance = (milliseconds: number) => {
    const target = now + milliseconds;
    while (true) {
      const next = timers
        .filter((timer) => !timer.cancelled && timer.at <= target)
        .sort((left, right) => left.at - right.at)[0];
      if (!next) break;
      next.cancelled = true;
      now = next.at;
      next.callback();
    }
    now = target;
  };

  return {
    scheduler,
    windowTarget,
    documentTarget,
    runInterval: () => interval?.(),
    intervalMs: () => intervalMs,
    intervalCleared: () => intervalCleared,
    setVisible: (value: boolean) => {
      visible = value;
    },
    advance,
  };
}

async function flushRefreshes(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

test("coalesces visible lifecycle triggers within the one-second window", async () => {
  let refreshes = 0;
  const harness = schedulerHarness(() => {
    refreshes += 1;
  });
  assert.equal(harness.intervalMs(), 20_000);

  harness.windowTarget.dispatchEvent(new Event("focus"));
  harness.documentTarget.dispatchEvent(new Event("visibilitychange"));
  await flushRefreshes();
  assert.equal(refreshes, 1);

  harness.advance(999);
  await flushRefreshes();
  assert.equal(refreshes, 1);
  harness.advance(1);
  await flushRefreshes();
  assert.equal(refreshes, 2);
});

test("keeps one trailing refresh without overlapping in-flight work", async () => {
  let refreshes = 0;
  let resolveRefresh: (() => void) | undefined;
  const harness = schedulerHarness(
    () =>
      new Promise<void>((resolve) => {
        refreshes += 1;
        resolveRefresh = resolve;
      }),
  );

  harness.scheduler.requestRefresh();
  await flushRefreshes();
  assert.equal(refreshes, 1);
  harness.scheduler.requestRefresh();
  harness.runInterval();
  harness.advance(1_000);
  assert.equal(refreshes, 1);

  resolveRefresh?.();
  await flushRefreshes();
  assert.equal(refreshes, 2);
});

test("ignores hidden triggers, recovers from rejection, and cleans up", async () => {
  let refreshes = 0;
  const harness = schedulerHarness(() => {
    refreshes += 1;
    return Promise.reject(new Error("offline"));
  });

  harness.setVisible(false);
  harness.windowTarget.dispatchEvent(new Event("focus"));
  harness.runInterval();
  await flushRefreshes();
  assert.equal(refreshes, 0);

  harness.setVisible(true);
  harness.documentTarget.dispatchEvent(new Event("visibilitychange"));
  await flushRefreshes();
  assert.equal(refreshes, 1);

  harness.scheduler.stop();
  assert.equal(harness.intervalCleared(), true);
  harness.advance(1_000);
  harness.windowTarget.dispatchEvent(new Event("focus"));
  harness.documentTarget.dispatchEvent(new Event("visibilitychange"));
  await flushRefreshes();
  assert.equal(refreshes, 1);
});
