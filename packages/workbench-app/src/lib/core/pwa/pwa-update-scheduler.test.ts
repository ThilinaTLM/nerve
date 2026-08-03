import assert from "node:assert/strict";
import { test } from "node:test";
import { startPwaUpdateScheduler } from "./pwa-update-scheduler";

function schedulerHarness(
  checkForUpdate: () => void | Promise<void> = () => undefined,
) {
  const windowTarget = new EventTarget();
  const documentTarget = new EventTarget();
  let interval: (() => void) | undefined;
  let intervalMs: number | undefined;
  let intervalCleared = false;
  let visible = true;
  let now = 0;

  const stop = startPwaUpdateScheduler({
    checkForUpdate,
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

  return {
    stop,
    windowTarget,
    documentTarget,
    runInterval: () => interval?.(),
    intervalMs: () => intervalMs,
    intervalCleared: () => intervalCleared,
    setVisible: (value: boolean) => {
      visible = value;
    },
    advance: (milliseconds: number) => {
      now += milliseconds;
    },
  };
}

async function flushChecks(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

test("checks for updates from visible lifecycle and interval events", async () => {
  let checks = 0;
  const harness = schedulerHarness(() => {
    checks += 1;
  });

  assert.equal(harness.intervalMs(), 60 * 60_000);

  harness.windowTarget.dispatchEvent(new Event("focus"));
  await flushChecks();
  assert.equal(checks, 1);

  harness.advance(60_000);
  harness.documentTarget.dispatchEvent(new Event("visibilitychange"));
  await flushChecks();
  assert.equal(checks, 2);

  harness.advance(60_000);
  harness.windowTarget.dispatchEvent(new Event("online"));
  await flushChecks();
  assert.equal(checks, 3);

  harness.advance(60_000);
  harness.runInterval();
  await flushChecks();
  assert.equal(checks, 4);
});

test("skips hidden and throttled update checks", async () => {
  let checks = 0;
  const harness = schedulerHarness(() => {
    checks += 1;
  });

  harness.setVisible(false);
  harness.windowTarget.dispatchEvent(new Event("focus"));
  harness.windowTarget.dispatchEvent(new Event("online"));
  harness.runInterval();
  await flushChecks();
  assert.equal(checks, 0);

  harness.setVisible(true);
  harness.windowTarget.dispatchEvent(new Event("focus"));
  harness.documentTarget.dispatchEvent(new Event("visibilitychange"));
  await flushChecks();
  assert.equal(checks, 1);

  harness.advance(59_999);
  harness.windowTarget.dispatchEvent(new Event("focus"));
  await flushChecks();
  assert.equal(checks, 1);

  harness.advance(1);
  harness.windowTarget.dispatchEvent(new Event("focus"));
  await flushChecks();
  assert.equal(checks, 2);
});

test("contains rejected checks and cleans up all event sources", async () => {
  let checks = 0;
  const harness = schedulerHarness(() => {
    checks += 1;
    return Promise.reject(new Error("offline"));
  });

  harness.windowTarget.dispatchEvent(new Event("focus"));
  await flushChecks();
  assert.equal(checks, 1);

  harness.stop();
  assert.equal(harness.intervalCleared(), true);

  harness.advance(60_000);
  harness.windowTarget.dispatchEvent(new Event("focus"));
  harness.windowTarget.dispatchEvent(new Event("online"));
  harness.documentTarget.dispatchEvent(new Event("visibilitychange"));
  assert.equal(checks, 1);
});
