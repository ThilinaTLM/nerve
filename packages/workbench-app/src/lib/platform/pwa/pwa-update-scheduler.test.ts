import assert from "node:assert/strict";
import { test } from "node:test";
import { createFakeClock, flush } from "../polling/fake-clock";
import { startPwaUpdateScheduler } from "./pwa-update-scheduler";

function schedulerHarness(
  checkForUpdate: () => void | Promise<void> = () => undefined,
) {
  const windowTarget = new EventTarget();
  const documentTarget = new EventTarget();
  const fake = createFakeClock();
  let visible = true;

  const stop = startPwaUpdateScheduler({
    checkForUpdate,
    clock: fake.clock,
    window: {
      addEventListener: windowTarget.addEventListener.bind(windowTarget),
      removeEventListener: windowTarget.removeEventListener.bind(windowTarget),
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
    fake,
    windowTarget,
    documentTarget,
    setVisible: (value: boolean) => {
      visible = value;
    },
  };
}

test("checks for updates from visible lifecycle and interval events", async () => {
  let checks = 0;
  const harness = schedulerHarness(() => {
    checks += 1;
  });

  harness.windowTarget.dispatchEvent(new Event("focus"));
  await flush();
  assert.equal(checks, 1);

  await harness.fake.advance(60_000);
  harness.documentTarget.dispatchEvent(new Event("visibilitychange"));
  await flush();
  assert.equal(checks, 2);

  await harness.fake.advance(60_000);
  harness.windowTarget.dispatchEvent(new Event("online"));
  await flush();
  assert.equal(checks, 3);

  // The hourly tick re-arms after each run, so it fires one hour after the last.
  await harness.fake.advance(60 * 60_000);
  assert.equal(checks, 4);
  harness.stop();
});

test("skips hidden and throttled update checks", async () => {
  let checks = 0;
  const harness = schedulerHarness(() => {
    checks += 1;
  });

  harness.setVisible(false);
  harness.windowTarget.dispatchEvent(new Event("focus"));
  harness.windowTarget.dispatchEvent(new Event("online"));
  await harness.fake.advance(2 * 60 * 60_000);
  assert.equal(checks, 0);

  harness.setVisible(true);
  harness.windowTarget.dispatchEvent(new Event("focus"));
  harness.documentTarget.dispatchEvent(new Event("visibilitychange"));
  await flush();
  assert.equal(checks, 1);

  await harness.fake.advance(59_999);
  harness.windowTarget.dispatchEvent(new Event("focus"));
  await flush();
  assert.equal(checks, 1);

  await harness.fake.advance(1);
  harness.windowTarget.dispatchEvent(new Event("focus"));
  await flush();
  assert.equal(checks, 2);
  harness.stop();
});

test("contains rejected checks and cleans up all event sources", async () => {
  let checks = 0;
  const harness = schedulerHarness(() => {
    checks += 1;
    return Promise.reject(new Error("offline"));
  });

  harness.windowTarget.dispatchEvent(new Event("focus"));
  await flush();
  assert.equal(checks, 1);

  harness.stop();
  assert.equal(harness.fake.pending(), 0);

  await harness.fake.advance(60_000);
  harness.windowTarget.dispatchEvent(new Event("focus"));
  harness.windowTarget.dispatchEvent(new Event("online"));
  harness.documentTarget.dispatchEvent(new Event("visibilitychange"));
  await flush();
  assert.equal(checks, 1);
});
