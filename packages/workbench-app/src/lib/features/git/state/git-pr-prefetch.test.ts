import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  GitPrPrefetchScheduler,
  type PrPrefetchClock,
} from "./git-pr-prefetch.js";

function setup() {
  const timers = new Map<number, () => void>();
  let id = 0;
  const clock: PrPrefetchClock = {
    setTimeout: (callback) => {
      timers.set(++id, callback);
      return id as unknown as ReturnType<typeof setTimeout>;
    },
    clearTimeout: (timer) => {
      timers.delete(timer as unknown as number);
    },
  };
  const fresh = new Set<string>();
  const calls: {
    project: string;
    repo: string;
    isCurrent: () => boolean;
    finish: () => void;
  }[] = [];
  const scheduler = new GitPrPrefetchScheduler({
    clock,
    isFresh: (project, repo) => fresh.has(`${project}/${repo}`),
    load: (project, repo, isCurrent) =>
      new Promise<void>((resolve) => {
        calls.push({
          project,
          repo,
          isCurrent,
          finish: () => {
            if (isCurrent()) fresh.add(`${project}/${repo}`);
            resolve();
          },
        });
      }),
  });
  const tick = () => {
    const entry = timers.entries().next().value;
    if (entry) {
      timers.delete(entry[0]);
      entry[1]();
    }
  };
  const settle = async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  };
  return { calls, fresh, scheduler, tick, settle };
}

describe("GitPrPrefetchScheduler", () => {
  it("calls native timers without an incompatible clock-object receiver", (t) => {
    const timer = 1 as unknown as ReturnType<typeof setTimeout>;
    const set = t.mock.method(
      globalThis,
      "setTimeout",
      function (this: unknown, _callback: () => void, delay: number) {
        assert.ok(
          this === undefined || this === globalThis,
          "browser setTimeout rejects custom receivers",
        );
        assert.equal(delay, 200);
        return timer;
      },
    );
    const clear = t.mock.method(
      globalThis,
      "clearTimeout",
      function (this: unknown, handle: ReturnType<typeof setTimeout>) {
        assert.ok(
          this === undefined || this === globalThis,
          "browser clearTimeout rejects custom receivers",
        );
        assert.equal(handle, timer);
      },
    );
    const scheduler = new GitPrPrefetchScheduler({
      isFresh: () => false,
      load: async () => {},
    });
    scheduler.schedule("p", "selected", ["selected", "background"]);
    assert.equal(set.mock.callCount(), 1);
    scheduler.cancel();
    assert.equal(clear.mock.callCount(), 1);
  });
  it("starts selected first, deduplicates demand, skips fresh repos and staggers background reads", async () => {
    const s = setup();
    s.fresh.add("p/fresh");
    s.scheduler.schedule("p", "selected", [
      "other",
      "fresh",
      "other",
      "selected",
      "last",
    ]);
    s.scheduler.schedule("p", "selected", [
      "other",
      "fresh",
      "other",
      "selected",
      "last",
    ]);
    assert.deepEqual(
      s.calls.map((c) => c.repo),
      ["selected"],
    );
    s.calls[0].finish();
    await s.settle();
    s.tick();
    assert.deepEqual(
      s.calls.map((c) => c.repo),
      ["selected", "other"],
    );
    s.tick();
    assert.equal(s.calls.length, 2);
    s.calls[1].finish();
    await s.settle();
    assert.equal(s.calls.length, 2);
    s.tick();
    assert.deepEqual(
      s.calls.map((c) => c.repo),
      ["selected", "other", "last"],
    );
  });

  it("keeps background concurrency at one without delaying a newly selected repo", async () => {
    const s = setup();
    s.scheduler.schedule("p", "a", ["a", "b", "c", "d"]);
    s.tick();
    s.scheduler.schedule("p", "d", ["a", "b", "c", "d"]);
    assert.deepEqual(
      s.calls.map((c) => c.repo),
      ["a", "b", "d"],
    );
    s.tick();
    assert.equal(s.calls.length, 3);
    s.calls[1].finish();
    await s.settle();
    // The completed background repo is now fresh even if another demand queued it.
    s.fresh.add("p/a");
    s.tick();
    s.tick();
    s.tick();
    assert.deepEqual(
      s.calls.map((c) => c.repo),
      ["a", "b", "d", "c"],
    );
  });

  it("invalidates in-flight publications and queued work on project switch", async () => {
    const s = setup();
    s.scheduler.schedule("old", "a", ["a", "b", "never"]);
    s.tick();
    s.scheduler.schedule("new", "x", ["x", "y"]);
    assert.equal(s.calls[0].isCurrent(), false);
    assert.equal(s.calls[1].isCurrent(), false);
    assert.equal(s.calls[2].isCurrent(), true);
    s.tick();
    assert.equal(s.calls.length, 3);
    s.calls[1].finish();
    await s.settle();
    s.tick();
    assert.deepEqual(
      s.calls.map((c) => c.repo),
      ["a", "b", "x", "y"],
    );
    s.scheduler.cancel();
    assert.equal(s.calls[3].isCurrent(), false);
    s.tick();
    assert.equal(s.calls.length, 4);
  });

  it("cancels deferred work on panel close", () => {
    const s = setup();
    s.scheduler.schedule("p", "a", ["a", "b"]);
    s.scheduler.cancel();
    assert.equal(s.calls[0].isCurrent(), false);
    s.tick();
    assert.equal(s.calls.length, 1);
  });

  it("rechecks freshness immediately before deferred work", () => {
    const s = setup();
    s.fresh.add("p/a");
    s.scheduler.schedule("p", "a", ["a", "b"]);
    s.fresh.add("p/b");
    s.tick();
    assert.equal(s.calls.length, 0);
  });
});
