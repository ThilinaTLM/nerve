import assert from "node:assert/strict";
import { test } from "node:test";
import { PrWatchDelivery } from "./pr-store-model";
import {
  acceptRevision,
  CoalescedRead,
  isEmptyGitInterest,
  mergeGitInterests,
  needsRevisionWait,
  planEventReads,
} from "./git-store-model";

const proj = "proj_one";

test("ingest keeps newer revisions and accepts equal ones", () => {
  const current = { revision: 5, stale: true };
  assert.equal(acceptRevision(current, { revision: 4, stale: false }), current);
  const equal = { revision: 5, stale: false };
  assert.equal(acceptRevision(current, equal), equal);
  const newer = { revision: 6, stale: false };
  assert.equal(acceptRevision(current, newer), newer);
  // After a daemon restart the client resets to -1 and takes anything.
  const reset = { revision: -1, stale: true };
  const restarted = { revision: 1, stale: false };
  assert.equal(acceptRevision(reset, restarted), restarted);
});

test("interests merge into one request per project", () => {
  const merged = mergeGitInterests(
    [
      { projectId: proj, visible: true, detail: ["api"], hint: "ui" },
      {
        projectId: proj,
        visible: false,
        detail: ["other", "api"],
        hint: "api",
      },
    ],
    true,
  );
  assert.deepEqual(merged, {
    projectId: proj,
    visible: true,
    detail: ["api", "other"],
    hint: "ui",
  });
  assert.equal(mergeGitInterests([], true), undefined);
});

test("a hidden page releases all demand", () => {
  const merged = mergeGitInterests(
    [{ projectId: proj, visible: true, detail: ["api"] }],
    false,
  )!;
  assert.deepEqual(merged, { projectId: proj, visible: false });
  assert.equal(isEmptyGitInterest(merged), true);
  assert.equal(isEmptyGitInterest({ ...merged, hint: "x" }), false);
});

test("event pings plan only newer reads for held content", () => {
  const held = { snapshotRevision: 4, detailRevisions: { api: 4, ui: 7 } };
  assert.deepEqual(
    planEventReads(
      { revision: 5, repos: ["api"], detail: ["api", "ui"] },
      held,
    ),
    { snapshot: true, details: ["api"] },
  );
  assert.deepEqual(
    planEventReads({ revision: 5, repos: [], detail: ["other"] }, held),
    { snapshot: false, details: [] },
  );
  assert.deepEqual(
    planEventReads(
      { revision: 4, repos: ["api"], detail: [] },
      { snapshotRevision: 4, detailRevisions: {} },
    ),
    { snapshot: false, details: [] },
  );
  assert.equal(
    planEventReads(
      { revision: 1, repos: ["api"], detail: [] },
      { detailRevisions: {} },
    ).snapshot,
    true,
  );
});

test("mutations wait only for revisions not applied yet", () => {
  assert.equal(needsRevisionWait(4, 5), true);
  assert.equal(needsRevisionWait(5, 5), false);
  assert.equal(needsRevisionWait(undefined, 0), true);
  assert.equal(needsRevisionWait(3, undefined), false);
});

test("coalesced reads share one follow-up that starts after the call", async () => {
  const started: number[] = [];
  const releases: Array<() => void> = [];
  const read = new CoalescedRead(
    () =>
      new Promise<void>((resolve) => {
        started.push(started.length);
        releases.push(resolve);
      }),
  );
  const first = read.fresh();
  const second = read.fresh();
  const third = read.fresh();
  assert.equal(started.length, 1);
  releases[0]();
  await first;
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(started.length, 2);
  releases[1]();
  await Promise.all([second, third]);
  assert.equal(started.length, 2);
  // Idle again: the next call reads at once.
  const fourth = read.fresh();
  assert.equal(started.length, 3);
  releases[2]();
  await fourth;
});

test("watch delivery is debounced and serialized", async () => {
  const log: string[] = [];
  let release!: () => void;
  const delivery = new PrWatchDelivery(async () => {
    log.push("start");
    await new Promise<void>((resolve) => (release = resolve));
    log.push("end");
  }, 5);
  delivery.schedule();
  delivery.schedule();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(log, ["start"]);
  delivery.schedule();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(log, ["start"], "second delivery waits for the first");
  release();
  await new Promise((resolve) => setTimeout(resolve, 10));
  release();
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.deepEqual(log, ["start", "end", "start", "end"]);
});
