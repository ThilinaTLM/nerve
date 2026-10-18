import assert from "node:assert/strict";
import { test } from "node:test";
import { GitRemoteCache } from "../../src/git/git-remote-cache.js";
import { parseGithubIssues } from "../../src/git/git-github-issues.js";
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

test("remote snapshots never wait, coalesce refresh, retain stale values and back off failures", async () => {
  let now = 0;
  let calls = 0;
  let release!: (value: string) => void;
  const cache = new GitRemoteCache<string>(100, 2, () => now);
  const load = () => {
    calls++;
    return new Promise<string>((resolve) => {
      release = resolve;
    });
  };
  assert.deepEqual(cache.read("repo", load), {
    status: "loading",
    value: null,
    refreshing: true,
    updatedAt: null,
  });
  cache.read("repo", load, true);
  await tick();
  assert.equal(calls, 1);
  release("cached");
  await tick();
  const fresh = cache.read("repo", load);
  assert.equal(fresh.value, "cached");
  assert.equal(fresh.status, "fresh");
  assert.equal(calls, 1);
  now = 101;
  const stale = cache.read("repo", async () => {
    calls++;
    throw new Error("secret");
  });
  assert.equal(stale.value, "cached");
  assert.equal(stale.refreshing, true);
  assert.equal(stale.status, "stale");
  await tick();
  const failed = cache.read("repo", load);
  assert.equal(failed.refreshing, false);
  assert.equal(failed.status, "stale");
  assert.equal(failed.updatedAt, fresh.updatedAt);
  assert.equal(failed.value, fresh.value);
  assert.equal(calls, 2);
  await cache.close();
});
test("eviction and close cancel background work", async () => {
  const signals: AbortSignal[] = [];
  const cache = new GitRemoteCache<string>(100, 1);
  const notifications: string[] = [];
  cache.onSettled((key) => {
    notifications.push(key);
  });
  const load = (signal: AbortSignal) => {
    signals.push(signal);
    return new Promise<string>((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), {
        once: true,
      });
    });
  };
  cache.read("a", load);
  await tick();
  cache.read("b", load);
  await tick();
  assert.equal(signals[0]?.aborted, true);
  await cache.close();
  assert.equal(signals[1]?.aborted, true);
  assert.deepEqual(notifications, []);
});
test("issue summaries are bounded, validate fields and omit bodies", () => {
  const item = {
    number: 1,
    title: "t".repeat(2000),
    url: "https://github.com/test/test/issues/1",
    updatedAt: "2026-10-18T00:00:00Z",
    state: "OPEN",
    author: { login: "tester" },
    body: "private",
  };
  const result = parseGithubIssues(
    JSON.stringify(Array.from({ length: 110 }, () => item)),
  );
  assert.equal(result.length, 100);
  assert.equal(result[0]?.title.length, 1000);
  assert.equal("body" in result[0]!, false);
  assert.throws(() =>
    parseGithubIssues(JSON.stringify([{ ...item, url: "javascript:bad" }])),
  );
});

void test("freshness subscribers see settled success/failure snapshots and unsubscribe cleanly", async () => {
  let now = 0;
  let fail = false;
  const cache = new GitRemoteCache<string>(100, 2, () => now);
  const load = async () => {
    if (fail) throw new Error("synthetic failure");
    return "fresh";
  };
  const states: {
    value: string | null;
    refreshing: boolean;
    status: string;
    updatedAt: string | null;
  }[] = [];
  cache.onSettled(() => {
    throw new Error("subscriber failure");
  });
  const unsubscribe = cache.onSettled((key) => {
    const current = cache.read(key, load);
    states.push({
      value: current.value,
      refreshing: current.refreshing,
      status: current.status,
      updatedAt: current.updatedAt,
    });
  });
  cache.read("repo", load);
  await tick();
  assert.deepEqual(states, [
    {
      value: "fresh",
      refreshing: false,
      status: "fresh",
      updatedAt: new Date(0).toISOString(),
    },
  ]);
  fail = true;
  now = 101;
  cache.read("repo", load);
  await tick();
  assert.deepEqual(states[1], {
    value: "fresh",
    refreshing: false,
    status: "stale",
    updatedAt: new Date(0).toISOString(),
  });
  unsubscribe();
  now = 202;
  cache.read("repo", load);
  await tick();
  assert.equal(states.length, 2);
  await cache.close();
});

void test("cold failures are unavailable and retry backoff cannot exceed sixty seconds", async () => {
  let now = 0;
  let calls = 0;
  const cache = new GitRemoteCache<string>(300_000, 2, () => now);
  const load = async () => {
    calls++;
    throw new Error("synthetic private failure");
  };
  assert.equal(cache.read("repo", load).status, "loading");
  await tick();
  const unavailable = cache.read("repo", load);
  assert.deepEqual(unavailable, {
    status: "unavailable",
    value: null,
    refreshing: false,
    updatedAt: null,
  });
  now = 59_999;
  assert.equal(cache.read("repo", load).status, "unavailable");
  assert.equal(calls, 1);
  now = 60_000;
  assert.equal(cache.read("repo", load).status, "loading");
  await tick();
  assert.equal(calls, 2);
  await cache.close();
});

void test("late evicted generations cannot publish settlement or overwrite replacement data", async () => {
  const cache = new GitRemoteCache<string>(100, 1);
  const events: string[] = [];
  cache.onSettled((key) => {
    events.push(key);
  });
  let release!: (value: string) => void;
  cache.read(
    "a",
    () =>
      new Promise<string>((resolve) => {
        release = resolve;
      }),
  );
  await tick();
  cache.read("b", async () => "evicted-before-start");
  cache.read("a", async () => "replacement");
  await tick();
  release("old");
  await tick();
  assert.equal(
    cache.read("a", async () => {
      assert.fail("fresh replacement reloaded");
    }).value,
    "replacement",
  );
  assert.deepEqual(events, ["a"]);
  await cache.close();
  assert.deepEqual(events, ["a"]);
});
