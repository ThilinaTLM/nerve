import assert from "node:assert/strict";
import { test } from "node:test";
import { ActivityService } from "./activity.service.js";
const input = (title = "Work") => ({ kind: "test.work", title });

void test("terminal lifecycle ignores late progress; successes stay until clear", () => {
  const service = new ActivityService(() => undefined);
  const work = service.start(input());
  work.progress({ phase: "Receiving", progress: { completed: 2, total: 4 } });
  work.succeed();
  work.fail({ message: "late failure" });
  work.progress({ phase: "late" });
  assert.equal(service.list()[0].status, "succeeded");
  assert.equal(service.list()[0].phase, "Receiving");
  const snapshot = service.list();
  snapshot[0].title = "mutated";
  assert.equal(service.list()[0].title, "Work");
  assert.equal(service.clear(), 1);
  assert.deepEqual(service.list(), []);
});

void test("retention evicts oldest finished, never running, across all projects", () => {
  const service = new ActivityService(() => undefined, 2);
  const running = service.start({
    ...input("running"),
    scope: { projectId: "other" },
  });
  const firstStarted = service.start(input("finished last"));
  const firstFinished = service.start(input("finished first"));
  firstFinished.succeed();
  service.start(input("finished second")).succeed();
  firstStarted.succeed();
  assert.deepEqual(
    service.list().map((entry) => entry.title),
    ["finished last", "finished second", "running"],
  );
  assert.equal(service.dismiss(running.id), 0);
  assert.equal(service.clear(), 2);
  assert.equal(service.list()[0].id, running.id);
});

void test("cancellation reflects producer capability, refusal and actual completion", async () => {
  const service = new ActivityService(() => undefined);
  const unsupported = service.start(input());
  assert.equal((await service.cancel(unsupported.id)).accepted, false);
  let refuse = true;
  const work = service.start(input(), { cancel: () => !refuse });
  assert.equal((await service.cancel(work.id)).accepted, false);
  assert.equal(service.list()[0].actions.cancel, true);
  refuse = false;
  assert.equal((await service.cancel(work.id)).accepted, true);
  assert.equal(service.list()[0].status, "running");
  assert.equal(service.list()[0].actions.cancel, false);
  work.succeed(); // Completion can win a cancellation race.
  assert.equal(service.list()[0].status, "succeeded");
});

void test("retry uses producer, guards overlapping actions and reports errors", async () => {
  let release!: (id: string) => void;
  const service = new ActivityService(() => undefined);
  const work = service.start(input(), {
    retry: () =>
      new Promise<string>((resolve) => {
        release = resolve;
      }),
  });
  assert.equal((await service.retry(work.id)).accepted, false);
  work.fail({ message: "Safe failure" });
  const retry = service.retry(work.id);
  assert.equal((await service.retry(work.id)).accepted, false);
  release("new-id");
  assert.deepEqual(await retry, { accepted: true, activityId: "new-id" });
  const broken = service.start(input(), {
    retry: () => {
      throw new Error("Policy denied");
    },
  });
  broken.cancelled();
  assert.deepEqual(await service.retry(broken.id), {
    accepted: false,
    reason: "Activity action failed. Check producer status and permissions.",
  });
});

void test("publication failure does not fail work and stale handles cannot affect reused IDs", () => {
  const service = new ActivityService(() => {
    throw new Error("offline");
  });
  const old = service.start({ ...input(), id: "same" });
  old.succeed();
  service.dismiss(old.id);
  const fresh = service.start({ ...input(), id: "same" });
  old.fail({ message: "late" });
  old.progress({ phase: "stale" });
  assert.equal(service.list()[0].status, "running");
  assert.equal(service.list()[0].phase, undefined);
  fresh.cancelled();
  assert.equal(service.list()[0].status, "cancelled");
});

void test("dispose interrupts running entries and tombstones advance revisions", async () => {
  const updates: { id: string; revision: number; removed: boolean }[] = [];
  const service = new ActivityService((activity, removed) => {
    updates.push({
      id: activity.id,
      revision: activity.revision,
      removed: !!removed,
    });
  });
  const work = service.start(input());
  service.dispose();
  work.succeed();
  assert.equal(service.list()[0].status, "interrupted");
  assert.equal((await service.cancel(work.id)).accepted, false);
  assert.throws(() => service.start(input()), /closed/);
  service.clear();
  const terminal = updates.at(-2)!;
  const removed = updates.at(-1)!;
  assert.equal(removed.removed, true);
  assert.equal(removed.revision, terminal.revision + 1);
});

void test("clear during retry removes only reporting history, not producer work", async () => {
  let release!: (id: string) => void;
  const service = new ActivityService(() => undefined, 1);
  const work = service.start(input(), {
    retry: () =>
      new Promise<string>((resolve) => {
        release = resolve;
      }),
  });
  work.fail({ message: "Safe failure" });
  const retry = service.retry(work.id);
  assert.equal(service.clear(), 1);
  release("new-work");
  assert.deepEqual(await retry, { accepted: true, activityId: "new-work" });
  assert.deepEqual(service.list(), []);
});
