import assert from "node:assert/strict";
import { test } from "node:test";
import type { Activity } from "@nervekit/contracts/activity";
import { ActivityController } from "./activity-controller.js";
import { ActivityAttention } from "./activity-attention.js";
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
  let listCalls = 0;
  const failures: Activity[] = [];
  const baselines: Activity[][] = [];
  const controller = new ActivityController({
    list: () => {
      listCalls++;
      return new Promise<Activity[]>((done) => {
        resolve = done;
      });
    },
    subscribe: (next) => {
      handler = next;
      return () => undefined;
    },
    changed: (next) => {
      entries = next;
    },
    error: () => undefined,
    baseline: (activities) => baselines.push(activities),
    failed: (activity) => failures.push(activity),
  });
  return {
    controller,
    failures,
    baselines,
    emit: (activity: Activity, removed = false) =>
      handler({ activity, removed }),
    resolve: (next: Activity[]) => resolve(next),
    get entries() {
      return entries;
    },
    get listCalls() {
      return listCalls;
    },
  };
}
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

test("empty initial snapshot establishes baseline despite earlier client notices, not future daemon events", async () => {
  const ctx = setup();
  ctx.controller.start();
  ctx.controller.notify({
    key: "pr:read",
    title: "Read failed",
    status: "failed",
  });
  assert.deepEqual(ctx.baselines, []);
  ctx.resolve([]);
  await tick();
  assert.deepEqual(ctx.baselines, [[]]);
  ctx.emit(entry("future", "failed"));
  assert.deepEqual(ctx.baselines, [[]]);
  const reconnect = ctx.controller.refresh();
  ctx.resolve([entry("future", "failed"), entry("other", "succeeded")]);
  await reconnect;
  assert.deepEqual(ctx.baselines, [[]]);
  assert.deepEqual(
    ctx.failures.map((activity) => activity.id),
    ["future"],
  );
});

test("initial baseline includes pre-existing snapshot entries but excludes concurrent live feedback", async () => {
  const ctx = setup();
  ctx.controller.start();
  ctx.emit(entry("live", "failed", 2));
  ctx.resolve([entry("existing", "succeeded"), entry("live", "failed", 2)]);
  await tick();
  assert.deepEqual(
    ctx.baselines.map((activities) =>
      activities.map((activity) => activity.id),
    ),
    [["existing"]],
  );
});

test("disposed snapshot cannot establish baseline before the next successful snapshot", async () => {
  const ctx = setup();
  ctx.controller.start();
  ctx.controller.dispose();
  ctx.resolve([entry("stale", "succeeded")]);
  await tick();
  assert.deepEqual(ctx.baselines, []);
  ctx.controller.start();
  ctx.resolve([]);
  await tick();
  assert.deepEqual(ctx.baselines, [[]]);
});

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

const started = (id: string) => ({
  id,
  kind: "git.fetch",
  title: `Fetch ${id}`,
  scope: { projectId: "proj_A", repositoryPath: id },
});

test("start acknowledgment creates a safe parent-aware placeholder that authoritative events supersede", async () => {
  const ctx = setup();
  ctx.controller.start();
  ctx.resolve([]);
  await tick();
  const input = { ...started("child"), parentId: "bulk" };
  ctx.controller.observeStarted(input);
  const placeholder = ctx.entries[0];
  assert.equal(placeholder.id, "child");
  assert.equal(placeholder.parentId, "bulk");
  assert.equal(placeholder.status, "queued");
  assert.equal(placeholder.revision, 0);
  assert.deepEqual(placeholder.actions, { cancel: false, retry: false });
  assert.ok(Number.isFinite(Date.parse(placeholder.startedAt)));
  input.scope.projectId = "mutated";
  assert.equal(placeholder.scope?.projectId, "proj_A");
  ctx.emit({
    ...entry("child", "running", 1),
    actions: { cancel: true, retry: false },
  });
  assert.equal(ctx.entries[0].status, "running");
  assert.equal(ctx.entries[0].actions.cancel, true);
  await tick();
  assert.equal(ctx.listCalls, 2);
  ctx.resolve([entry("child", "running", 1)]);
  await tick();
});

test("terminal events and removal tombstones arriving before acknowledgment are never overwritten or resurrected", async () => {
  const ctx = setup();
  ctx.controller.start();
  ctx.resolve([]);
  await tick();
  ctx.emit(entry("finished", "succeeded", 2));
  ctx.controller.observeStarted(started("finished"));
  assert.equal(ctx.entries[0].status, "succeeded");
  assert.equal(ctx.entries[0].revision, 2);
  ctx.emit(entry("removed", "failed", 3), true);
  ctx.controller.observeStarted(started("removed"));
  assert.equal(
    ctx.entries.some((item) => item.id === "removed"),
    false,
  );
  await tick();
  assert.equal(ctx.listCalls, 1);
});

test("ack during an older snapshot is buffered, with one fresh follow-up that can infer interruption", async () => {
  const ctx = setup();
  ctx.controller.start();
  ctx.controller.observeStarted(started("new"));
  ctx.controller.observeStarted(started("new"));
  ctx.resolve([]);
  await tick();
  assert.equal(ctx.entries[0].status, "queued");
  assert.equal(ctx.listCalls, 2);
  ctx.resolve([]);
  await tick();
  assert.equal(ctx.entries[0].status, "interrupted");
  // Inferred interruption is not authoritative: revision 1 must still win.
  ctx.emit(entry("new", "running", 1));
  assert.equal(ctx.entries[0].status, "running");
});

test("event/ack races during refresh keep terminal truth and tombstones through the follow-up", async () => {
  const ctx = setup();
  ctx.controller.start();
  ctx.controller.observeStarted(started("completed"));
  ctx.controller.observeStarted(started("removed"));
  ctx.emit(entry("completed", "succeeded", 2));
  ctx.emit(entry("removed", "failed", 2), true);
  ctx.controller.observeStarted(started("removed"));
  ctx.resolve([]);
  await tick();
  assert.deepEqual(
    ctx.entries.map((item) => [item.id, item.status]),
    [["completed", "succeeded"]],
  );
  assert.equal(ctx.listCalls, 2);
  ctx.resolve([entry("completed", "succeeded", 2)]);
  await tick();
  assert.equal(ctx.entries[0].status, "succeeded");
  assert.equal(
    ctx.entries.some((item) => item.id === "removed"),
    false,
  );
});

test("bulk acknowledgments coalesce snapshot reads and preserve all queued children", async () => {
  const ctx = setup();
  ctx.controller.start();
  ctx.resolve([]);
  await tick();
  ctx.controller.observeStarted({ ...started("bulk"), kind: "git.fetch.all" });
  for (let index = 0; index < 250; index++)
    ctx.controller.observeStarted({
      ...started(`child-${index}`),
      parentId: "bulk",
    });
  assert.equal(ctx.entries.length, 251);
  assert.equal(ctx.listCalls, 1);
  await tick();
  assert.equal(ctx.listCalls, 2);
  ctx.resolve(ctx.entries);
  await tick();
  assert.equal(ctx.listCalls, 2);
  assert.equal(
    ctx.entries.filter((item) => item.parentId === "bulk").length,
    250,
  );
});

test("fresh reconnect missing an acknowledged operation infers interruption; disposal cancels queued reads", async () => {
  const ctx = setup();
  ctx.controller.observeStarted(started("before-start"));
  await tick();
  assert.equal(ctx.listCalls, 0);
  ctx.controller.start();
  ctx.resolve([entry("before-start", "running", 1)]);
  await tick();
  const reconnect = ctx.controller.refresh();
  ctx.resolve([]);
  await reconnect;
  assert.equal(ctx.entries[0].status, "interrupted");
  ctx.controller.observeStarted(started("dispose"));
  ctx.controller.dispose();
  await tick();
  assert.equal(ctx.listCalls, 2);
});

test("explicit fresh read covers queued acknowledgment refresh without scheduling a duplicate", async () => {
  const ctx = setup();
  ctx.controller.start();
  ctx.resolve([]);
  await tick();
  ctx.controller.observeStarted(started("new"));
  const refresh = ctx.controller.refresh();
  ctx.resolve([entry("new", "running", 1)]);
  await refresh;
  await tick();
  assert.equal(ctx.listCalls, 2);
  assert.equal(ctx.entries[0].status, "running");
});

test("acknowledged running work stays unbounded while finished retention remains 200", async () => {
  const ctx = setup();
  ctx.controller.start();
  ctx.resolve([]);
  await tick();
  for (let index = 0; index < 205; index++) {
    const id = `finished-${index}`;
    ctx.controller.observeStarted(started(id));
    ctx.emit(entry(id, "succeeded", 1));
  }
  for (let index = 0; index < 3; index++)
    ctx.controller.observeStarted(started(`running-${index}`));
  assert.equal(
    ctx.entries.filter((item) => item.status === "succeeded").length,
    200,
  );
  assert.equal(
    ctx.entries.filter((item) => item.status === "queued").length,
    3,
  );
  await tick();
  assert.equal(ctx.listCalls, 2);
  ctx.resolve(ctx.entries);
  await tick();
  assert.equal(ctx.entries.length, 203);
});

test("inferred interruption yields to authoritative same revision but never older events", async () => {
  const ctx = setup();
  ctx.controller.start();
  ctx.resolve([entry("running", "running", 5)]);
  await tick();
  const refresh = ctx.controller.refresh();
  ctx.resolve([]);
  await refresh;
  assert.equal(ctx.entries[0].status, "interrupted");
  ctx.emit(entry("running", "failed", 4));
  assert.equal(ctx.entries[0].status, "interrupted");
  assert.deepEqual(ctx.failures, []);
  ctx.emit(entry("running", "running", 5));
  assert.equal(ctx.entries[0].status, "running");
  assert.equal(ctx.entries[0].revision, 5);
});

test("client notices are completed, grouped, cloned and inbox-only without starting RPC work", () => {
  const ctx = setup();
  const scope = { projectId: "project" };
  ctx.controller.notify({
    key: "pr:refresh",
    title: "Refresh failed",
    status: "failed",
    message: "Network down",
    scope,
  });
  const first = ctx.entries[0];
  scope.projectId = "mutated";
  assert.equal(first.scope?.projectId, "project");
  assert.equal(first.status, "failed");
  assert.equal(first.kind, "client.notice");
  assert.deepEqual(first.error, { message: "Network down" });
  assert.equal(first.finishedAt, first.updatedAt);
  assert.deepEqual(first.actions, { cancel: false, retry: false });
  assert.equal(ctx.controller.isClientNotice(first.id), true);
  ctx.controller.notify({
    key: "pr:refresh",
    title: "Refreshed",
    status: "succeeded",
  });
  const replacement = ctx.entries[0];
  assert.equal(ctx.entries.length, 1);
  assert.notEqual(replacement.id, first.id);
  assert.equal(replacement.revision, first.revision + 1);
  assert.equal(replacement.status, "succeeded");
  assert.equal(replacement.error, undefined);
  assert.equal(replacement.message, undefined);
  assert.equal(replacement.scope, undefined);
  assert.equal(ctx.controller.isClientNotice(first.id), false);
  assert.equal(ctx.listCalls, 0);
  assert.deepEqual(ctx.failures, []);
});

test("client notices coexist with events and reconnect snapshots, including notifications during reads", async () => {
  const ctx = setup();
  ctx.controller.notify({
    key: "clipboard",
    title: "Copied",
    status: "succeeded",
  });
  const localId = ctx.entries[0].id;
  ctx.controller.start();
  ctx.emit(entry("daemon", "running"));
  ctx.controller.notify({
    key: "read",
    title: "Read failed",
    status: "failed",
    message: "Offline",
  });
  ctx.resolve([]);
  await tick();
  assert.equal(ctx.entries.length, 3);
  const reconnect = ctx.controller.refresh();
  ctx.resolve([entry("daemon", "succeeded", 2)]);
  await reconnect;
  assert.equal(ctx.entries.length, 3);
  assert.equal(
    ctx.entries.find((item) => item.id === localId)?.status,
    "succeeded",
  );
  assert.equal(
    ctx.entries.find((item) => item.id === "daemon")?.status,
    "succeeded",
  );
  assert.deepEqual(ctx.failures, []);
  ctx.controller.dispose();
  ctx.controller.start();
  ctx.resolve([]);
  await tick();
  assert.equal(ctx.entries.length, 2);
});

test("client dismiss and clear survive reconnect without tombstoning subsequent grouped notices", async () => {
  const ctx = setup();
  ctx.controller.start();
  ctx.resolve([entry("running"), entry("done", "succeeded")]);
  await tick();
  ctx.controller.notify({
    key: "read",
    title: "Read failed",
    status: "failed",
  });
  const dismissed = ctx.entries.find((item) => item.kind === "client.notice")!;
  ctx.controller.dismissLocal(dismissed.id);
  assert.equal(ctx.controller.isClientNotice(dismissed.id), false);
  const reconnect = ctx.controller.refresh();
  ctx.resolve([entry("running"), entry("done", "succeeded")]);
  await reconnect;
  assert.equal(ctx.entries.length, 2);
  ctx.controller.notify({
    key: "read",
    title: "Failed again",
    status: "failed",
  });
  ctx.controller.dismissLocal(dismissed.id);
  assert.equal(ctx.entries.length, 3);
  ctx.controller.clearClientNotices();
  assert.deepEqual(ctx.entries.map((item) => item.id).sort(), [
    "done",
    "running",
  ]);
  ctx.controller.notify({
    key: "read",
    title: "Read succeeded",
    status: "succeeded",
  });
  ctx.controller.clearLocal();
  assert.deepEqual(
    ctx.entries.map((item) => item.id),
    ["running"],
  );
  ctx.controller.notify({
    key: "read",
    title: "New feedback",
    status: "failed",
  });
  assert.equal(ctx.entries.length, 2);
});

test("client notices share the 200 finished bound with daemon entries and keep newest feedback", async () => {
  const ctx = setup();
  ctx.controller.start();
  ctx.resolve([entry("running"), entry("old", "succeeded")]);
  await tick();
  for (let index = 0; index < 205; index++)
    ctx.controller.notify({
      key: `notice-${index}`,
      title: `Notice ${index}`,
      status: "succeeded",
    });
  assert.equal(ctx.entries.length, 201);
  assert.equal(
    ctx.entries.filter((item) => item.kind === "client.notice").length,
    200,
  );
  assert.equal(
    ctx.entries.some((item) => item.title === "Notice 204"),
    true,
  );
  assert.equal(
    ctx.entries.some((item) => item.title === "Notice 0"),
    false,
  );
  assert.equal(
    ctx.entries.some((item) => item.id === "running"),
    true,
  );
});

test("grouped replacement resets id-based read and attention without daemon failure toasts", () => {
  const ctx = setup();
  const attention = new ActivityAttention();
  ctx.controller.notify({ key: "pr", title: "Failed", status: "failed" });
  const readIds = new Set([ctx.entries[0].id]);
  assert.equal(attention.update(ctx.entries, true), false);
  ctx.controller.notify({ key: "pr", title: "Failed again", status: "failed" });
  assert.equal(readIds.has(ctx.entries[0].id), false);
  assert.equal(attention.update(ctx.entries, false), true);
  assert.equal(attention.update(ctx.entries, true), false);
  ctx.controller.notify({ key: "pr", title: "Recovered", status: "succeeded" });
  assert.equal(attention.update(ctx.entries, false), false);
  ctx.controller.clearClientNotices();
  assert.equal(attention.update(ctx.entries, false), false);
  assert.deepEqual(ctx.failures, []);
});
