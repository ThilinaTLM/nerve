import assert from "node:assert/strict";
import { test } from "node:test";
import type { Activity } from "@nervekit/contracts/activity";
import { ActivityController } from "./activity-controller.js";
function entry(
  id: string,
  status: Activity["status"] = "running",
  revision = 1,
): Activity {
  return {
    id,
    kind: "test",
    title: id,
    status,
    revision,
    startedAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    actions: { cancel: false, retry: false },
  };
}
function setup() {
  let handler!: (update: { activity: Activity; removed?: boolean }) => void;
  let resolve!: (entries: Activity[]) => void;
  let entries: Activity[] = [];
  const failures: Activity[] = [];
  const controller = new ActivityController({
    list: () =>
      new Promise<Activity[]>((done) => {
        resolve = done;
      }),
    subscribe: (next) => {
      handler = next;
      return () => undefined;
    },
    changed: (next) => {
      entries = next;
    },
    error: () => undefined,
    failed: (activity) => failures.push(activity),
  });
  return {
    controller,
    failures,
    emit: (activity: Activity, removed = false) =>
      handler({ activity, removed }),
    resolve: (next: Activity[]) => resolve(next),
    get entries() {
      return entries;
    },
  };
}
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

test("subscription starts before snapshot and newer events win snapshot race", async () => {
  const ctx = setup();
  ctx.controller.start();
  ctx.emit(entry("one", "succeeded", 3));
  ctx.resolve([entry("one", "running", 1)]);
  await tick();
  assert.equal(ctx.entries[0].status, "succeeded");
  ctx.emit(entry("one", "running", 2));
  assert.equal(ctx.entries[0].status, "succeeded");
});

test("reconnect marks only missing running work interrupted, preserves server successes", async () => {
  const ctx = setup();
  ctx.controller.start();
  ctx.resolve([entry("lost"), entry("success", "succeeded")]);
  await tick();
  const refresh = ctx.controller.refresh();
  ctx.resolve([entry("success", "succeeded")]);
  await refresh;
  assert.equal(
    ctx.entries.find((item) => item.id === "lost")?.status,
    "interrupted",
  );
  assert.equal(
    ctx.entries.find((item) => item.id === "success")?.status,
    "succeeded",
  );
  ctx.controller.clearLocal();
  assert.deepEqual(ctx.entries, []);
});

test("removed events reconcile clear/eviction and disposal invalidates pending snapshots", async () => {
  const ctx = setup();
  ctx.controller.start();
  ctx.emit(entry("done", "succeeded"));
  ctx.emit(entry("done", "succeeded"), true);
  ctx.resolve([entry("done", "succeeded")]);
  await tick();
  assert.deepEqual(ctx.entries, []);
  const refresh = ctx.controller.refresh();
  ctx.controller.dispose();
  ctx.resolve([entry("late")]);
  await refresh;
  assert.deepEqual(ctx.entries, []);
});

test("latest reconnect wins overlapping snapshots", async () => {
  const ctx = setup();
  ctx.controller.start();
  ctx.resolve([]);
  await tick();
  const old = ctx.controller.refresh();
  ctx.resolve([entry("old")]);
  const latest = ctx.controller.refresh();
  ctx.resolve([entry("new")]);
  await Promise.all([old, latest]);
  assert.deepEqual(
    ctx.entries.map((item) => item.id),
    ["new"],
  );
});

test("tombstones reject late progress and stale removals cannot erase newer work", async () => {
  const ctx = setup();
  ctx.controller.start();
  ctx.resolve([]);
  await tick();
  ctx.emit(entry("work", "running", 3));
  ctx.emit(entry("work", "running", 2), true);
  assert.equal(ctx.entries.length, 1);
  ctx.emit(entry("work", "succeeded", 4), true);
  ctx.emit(entry("work", "running", 3));
  assert.deepEqual(ctx.entries, []);
});

test("failure announcements only follow accepted live transitions, not stale events or snapshots", async () => {
  const ctx = setup();
  ctx.controller.start();
  ctx.resolve([entry("existing", "failed", 2)]);
  await tick();
  assert.equal(ctx.failures.length, 0);
  ctx.emit(entry("existing", "failed", 2));
  ctx.emit(entry("existing", "failed", 3));
  assert.equal(ctx.failures.length, 0);
  ctx.emit(entry("new", "running", 1));
  ctx.emit(entry("new", "failed", 2));
  assert.deepEqual(
    ctx.failures.map((item) => item.id),
    ["new"],
  );
  ctx.emit(entry("new", "failed", 3), true);
  ctx.emit(entry("new", "failed", 2));
  assert.equal(ctx.failures.length, 1);
  const reconnect = ctx.controller.refresh();
  ctx.emit(entry("during-refresh", "failed", 1));
  ctx.resolve([]);
  await reconnect;
  assert.deepEqual(
    ctx.failures.map((item) => item.id),
    ["new", "during-refresh"],
  );
});

test("local dismissal suppresses delayed failure before tombstone delivery and across refresh", async () => {
  const ctx = setup();
  ctx.controller.start();
  ctx.resolve([entry("dismissed", "succeeded", 4)]);
  await tick();
  ctx.controller.dismissLocal("dismissed");
  ctx.emit(entry("dismissed", "failed", 3));
  ctx.emit(entry("dismissed", "succeeded", 2), true);
  const refresh = ctx.controller.refresh();
  ctx.resolve([]);
  await refresh;
  ctx.emit(entry("dismissed", "failed", 4));
  assert.deepEqual(ctx.entries, []);
  assert.deepEqual(ctx.failures, []);
});
