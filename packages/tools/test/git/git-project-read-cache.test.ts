import assert from "node:assert/strict";
import { test } from "node:test";
import { GitProjectReadCache } from "../../src/git/read/project-read-cache.js";
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

void test("35-second reads survive uncertain polls at 10/20/30 seconds and coalesce one demand-owned follow-up", async () => {
  let now = 0;
  const cache = new GitProjectReadCache<{
    version: number;
    freshness: { stale: boolean };
  }>(2, 30_000, () => now);
  const releases: (() => void)[] = [];
  const signals: AbortSignal[] = [];
  const load = (signal: AbortSignal, freshness: { stale: boolean }) =>
    new Promise<{ version: number; freshness: { stale: boolean } }>(
      (resolve) => {
        const version = releases.length;
        signals.push(signal);
        releases.push(() => resolve({ version, freshness }));
      },
    );
  const first = cache.get("p", "/root", load);
  await tick();
  for (now of [10_000, 20_000, 30_000]) {
    cache.invalidate("p", { uncertain: true });
    assert.equal(
      cache.get("p", "/root", load),
      first,
      "uncertain demand joins active work",
    );
    assert.equal(signals[0]!.aborted, false);
    assert.equal(releases.length, 1);
  }
  now = 35_000;
  releases[0]!();
  const stale = await first;
  assert.equal(
    stale.freshness.stale,
    true,
    "completion is explicitly stale, never relabelled fresh",
  );
  await tick();
  assert.equal(releases.length, 2);
  const followup = cache.get("p", "/root", load);
  assert.notEqual(followup, first);
  now = 40_000;
  cache.invalidate("p", { uncertain: true });
  now = 70_000;
  releases[1]!();
  assert.equal((await followup).freshness.stale, true);
  await tick();
  for (now of [80_000, 90_000, 100_000])
    cache.invalidate("p", { uncertain: true });
  await tick();
  assert.equal(releases.length, 2, "no third read or idle retry loop");
  cache.invalidate("p");
  assert.ok(
    signals.every((signal) => signal.aborted),
    "hard invalidation also cancels prior consumers in the deferred lineage",
  );
  await cache.close();
});

void test("shutdown aborts a deferred follow-up and waits for its actual completion", async () => {
  const cache = new GitProjectReadCache<string>();
  const releases: ((value: string) => void)[] = [];
  const signals: AbortSignal[] = [];
  const load = (signal: AbortSignal) =>
    new Promise<string>((resolve) => {
      signals.push(signal);
      releases.push(resolve);
    });
  const first = cache.get("p", "/root", load);
  await tick();
  cache.invalidate("p", { uncertain: true });
  releases[0]!("stale");
  await first;
  await tick();
  const followup = cache.get("p", "/root", load);
  const rejected = assert.rejects(followup, { name: "AbortError" });
  let closed = false;
  const closing = cache.close().then(() => {
    closed = true;
  });
  await rejected;
  assert.equal(closed, false);
  assert.ok(signals.every((signal) => signal.aborted));
  releases[1]!("closed");
  await closing;
  assert.equal(closed, true);
  assert.equal(releases.length, 2);
});

void test("uncertain idle invalidation waits for demand; deferred follow-up can become fresh", async () => {
  const cache = new GitProjectReadCache<{ freshness: { stale: boolean } }>();
  let reads = 0;
  const load = async (_signal: AbortSignal, freshness: { stale: boolean }) => {
    reads++;
    return { freshness };
  };
  const old = await cache.get("p", "/root", load);
  cache.invalidate("p", { uncertain: true });
  await tick();
  assert.equal(reads, 1);
  assert.equal(old.freshness.stale, true);
  const fresh = await cache.get("p", "/root", load);
  assert.equal(fresh.freshness.stale, false);
  assert.equal(reads, 2);
  await cache.close();
});

void test("manual supersession and shutdown abort deferred reads and shutdown awaits actual completion", async () => {
  const cache = new GitProjectReadCache<string>();
  let release!: (value: string) => void;
  let signal!: AbortSignal;
  const pending = cache.get("p", "/root", (current) => {
    signal = current;
    return new Promise<string>((resolve) => {
      release = resolve;
    });
  });
  await tick();
  cache.invalidate("p", { uncertain: true });
  const rejected = assert.rejects(pending, { name: "AbortError" });
  assert.equal(
    await cache.get("p", "/root", async () => "manual", true),
    "manual",
  );
  await rejected;
  assert.equal(signal.aborted, true);
  let closed = false;
  const closing = cache.close().then(() => {
    closed = true;
  });
  await tick();
  assert.equal(closed, false);
  release("old");
  await closing;
  assert.equal(closed, true);
});
void test("listing and status reuse project discovery and invalidation rejects stale generations", async () => {
  const cache = new GitProjectReadCache<string>();
  let reads = 0;
  let resolveOld!: (value: string) => void;
  const load = () => {
    reads++;
    return new Promise<string>((resolve) => {
      resolveOld = resolve;
    });
  };
  const listing = cache.get("p", "/root", load);
  const status = cache.get("p", "/root", load);
  assert.equal(listing, status);
  await tick();
  assert.equal(reads, 1);
  cache.invalidate("p");
  await assert.rejects(
    listing,
    (error: unknown) => error instanceof Error && error.name === "AbortError",
  );
  const fresh = cache.get("p", "/root", async () => "new");
  resolveOld("old");
  assert.equal(await fresh, "new");
  assert.equal(await cache.get("p", "/root", load), "new");
  await cache.close();
});
void test("new roots, explicit supersession, TTL and capacity cancel/discard older work", async () => {
  let now = 0;
  const cache = new GitProjectReadCache<string>(1, 100, () => now);
  assert.equal(await cache.get("p", "/a", async () => "a"), "a");
  assert.equal(await cache.get("p", "/b", async () => "b"), "b");
  assert.equal(
    await cache.get("p", "/b", async () => "forced", true),
    "forced",
  );
  now = 101;
  assert.equal(await cache.get("p", "/b", async () => "expired"), "expired");
  const stalled = cache.get(
    "p",
    "/b",
    async () => new Promise<string>(() => {}),
    true,
  );
  const rejection = assert.rejects(
    stalled,
    (error: unknown) => error instanceof Error && error.name === "AbortError",
  );
  assert.equal(await cache.get("q", "/q", async () => "q"), "q");
  await rejection;
  await cache.close();
});

void test("TTL starts at completion and shutdown awaits real work after rejecting consumers", async () => {
  let now = 0;
  const cache = new GitProjectReadCache<string>(2, 100, () => now);
  let release!: (value: string) => void;
  const pending = cache.get(
    "p",
    "/root",
    () =>
      new Promise<string>((resolve) => {
        release = resolve;
      }),
  );
  await tick();
  now = 1000;
  assert.equal(
    cache.get("p", "/root", async () => {
      assert.fail("TTL restarted pending work");
    }),
    pending,
  );
  const rejected = assert.rejects(
    pending,
    (error: unknown) => error instanceof Error && error.name === "AbortError",
  );
  let closed = false;
  const closing = cache.close().then(() => {
    closed = true;
  });
  await rejected;
  assert.equal(closed, false);
  release("late");
  await closing;
  assert.equal(closed, true);
  await assert.rejects(
    cache.get("p", "/root", async () => "new"),
    /closed/,
  );
});
