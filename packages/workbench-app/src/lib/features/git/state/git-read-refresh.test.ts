import assert from "node:assert/strict";
import { test } from "node:test";
import { QueryClient } from "@tanstack/query-core";
import { refreshGitRead } from "./git-read-refresh.js";
import {
  createGitOverviewReadGuard,
  gitOverviewReadInvalidation,
} from "./git-panel-refresh-policy.js";

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
const client = () =>
  new QueryClient({
    defaultOptions: { queries: { retry: 3, gcTime: Infinity } },
  });
type Read = { stale?: boolean; value: string };
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

void test("a TanStack-cached stale discovery is published then revalidated once and clears only its matching scope", async () => {
  const query = client(),
    key = ["git", "proj_a", "repos"];
  query.setQueryData<Read>(key, { stale: true, value: "cached" });
  const next = deferred<Read>();
  const modes: boolean[] = [];
  const flags = { discoveryA: false, discoveryB: true, overviewA: true };
  const published: string[] = [];
  const reading = refreshGitRead({
    client: query,
    queryKey: key,
    staleTime: 60_000,
    read: (followup) => {
      modes.push(followup);
      return next.promise;
    },
    publish: (value) => {
      flags.discoveryA = Boolean(value.stale);
      published.push(value.value);
    },
    isCurrent: () => true,
    hasDemand: () => true,
  });
  try {
    await tick();
    assert.deepEqual(published, ["cached"]);
    assert.equal(flags.discoveryA, true);
    assert.deepEqual(
      modes,
      [true],
      "cached stale payload cannot satisfy the soft follow-up without a real read",
    );
    next.resolve({ value: "fresh" });
    await reading;
    assert.deepEqual(published, ["cached", "fresh"]);
    assert.deepEqual(flags, {
      discoveryA: false,
      discoveryB: true,
      overviewA: true,
    });
    await tick();
    assert.equal(modes.length, 1, "fresh completion cannot schedule idle work");
  } finally {
    next.resolve({ value: "cleanup" });
    await reading;
    query.clear();
  }
});

void test("known overview invalidation soft-expires cached stale:false data before it may clear the UI flag", async () => {
  const query = client(),
    key = ["git", "known-invalidated", "overview"];
  query.setQueryData<Read>(key, { stale: false, value: "older-fresh" });
  const gate = deferred<Read>();
  const request = { invalidation: 4 };
  let invalidated = true,
    calls = 0;
  const guard = createGitOverviewReadGuard(request, invalidated);
  const seen: string[] = [];
  const reading = refreshGitRead({
    client: query,
    queryKey: key,
    staleTime: 60_000,
    invalidate: gitOverviewReadInvalidation({}, invalidated),
    read: async () => {
      calls++;
      guard.begin();
      return gate.promise;
    },
    publish: (value) => {
      invalidated = guard.isStale(value);
      seen.push(value.value);
    },
    isStale: () => invalidated,
    isCurrent: () => true,
    hasDemand: () => true,
    onFollowup: guard.expectRead,
  });
  try {
    await tick();
    assert.equal(
      calls,
      1,
      "the old query-fresh payload must not bypass read()",
    );
    assert.equal(invalidated, true);
    assert.deepEqual(seen, []);
    gate.resolve({ value: "new-read" });
    await reading;
    assert.equal(invalidated, false);
    assert.deepEqual(seen, ["new-read"]);
    assert.equal(calls, 1);
  } finally {
    gate.resolve({ value: "cleanup" });
    await reading;
    query.clear();
  }
});

void test("joining an older pending query cannot clear known overview invalidation until one genuine follow-up read", async () => {
  const query = client(),
    key = ["git", "older-pending", "overview"];
  const old = deferred<Read>(),
    fresh = deferred<Read>();
  let oldSignal!: AbortSignal;
  const active = query.fetchQuery({
    queryKey: key,
    queryFn: (context) => {
      oldSignal = context.signal;
      return old.promise;
    },
  });
  let invalidated = true,
    genuineReads = 0;
  const guard = createGitOverviewReadGuard({ invalidation: 3 }, invalidated);
  const seen: boolean[] = [];
  const reading = refreshGitRead({
    client: query,
    queryKey: key,
    staleTime: 60_000,
    invalidate: gitOverviewReadInvalidation({}, invalidated),
    read: async () => {
      genuineReads++;
      guard.begin();
      return fresh.promise;
    },
    publish: (value) => {
      invalidated = guard.isStale(value);
      seen.push(invalidated);
    },
    isStale: () => invalidated,
    isCurrent: () => true,
    hasDemand: () => true,
    onFollowup: guard.expectRead,
  });
  try {
    await tick();
    assert.equal(oldSignal.aborted, false);
    assert.equal(genuineReads, 0);
    old.resolve({ stale: false, value: "old-result" });
    await tick();
    assert.deepEqual(seen, [true]);
    assert.equal(genuineReads, 1);
    fresh.resolve({ value: "fresh-result" });
    await Promise.all([reading, active]);
    assert.deepEqual(seen, [true, false]);
    assert.equal(genuineReads, 1);
    assert.equal(oldSignal.aborted, false);
  } finally {
    old.resolve({ value: "cleanup-old" });
    fresh.resolve({ value: "cleanup-fresh" });
    await Promise.allSettled([active, reading]);
    query.clear();
  }
});

void test("soft follow-up joins an already pending real query without cancelling it or starting another RPC", async () => {
  const query = client(),
    key = ["git", "proj_a", "overview"];
  query.setQueryData<Read>(key, { stale: true, value: "cached" });
  const next = deferred<Read>();
  let signal!: AbortSignal;
  let calls = 0;
  const active = query.fetchQuery({
    queryKey: key,
    staleTime: 0,
    queryFn: (context) => {
      signal = context.signal;
      calls++;
      return next.promise;
    },
  });
  const seen: string[] = [];
  const reading = refreshGitRead({
    client: query,
    queryKey: key,
    staleTime: 60_000,
    read: async () => {
      assert.fail("existing active query was not joined");
    },
    publish: (value: Read) => {
      seen.push(value.value);
    },
    isCurrent: () => true,
    hasDemand: () => true,
  });
  try {
    await tick();
    assert.equal(signal.aborted, false);
    assert.equal(calls, 1);
    assert.deepEqual(seen, ["cached"]);
    next.resolve({ value: "joined-fresh" });
    await Promise.all([reading, active]);
    assert.deepEqual(seen, ["cached", "joined-fresh"]);
    assert.equal(signal.aborted, false);
    assert.equal(calls, 1);
  } finally {
    next.resolve({ value: "cleanup" });
    await Promise.allSettled([active, reading]);
    query.clear();
  }
});

void test("a still-stale or failed second result stops without a third read, query retry or false freshness", async () => {
  for (const fails of [false, true]) {
    const query = client();
    let calls = 0,
      stale = false,
      followups = 0;
    const published: Read[] = [];
    const reading = refreshGitRead({
      client: query,
      queryKey: ["git", "bounded", fails],
      staleTime: 60_000,
      read: async (followup): Promise<Read> => {
        calls++;
        if (followup && fails) throw new Error("follow-up failed");
        return { stale: true, value: followup ? "second" : "first" };
      },
      publish: (value) => {
        stale = Boolean(value.stale);
        published.push(value);
      },
      isCurrent: () => true,
      hasDemand: () => true,
      onFollowup: () => {
        followups++;
      },
    });
    try {
      if (fails) await assert.rejects(reading, /follow-up failed/);
      else await reading;
      await tick();
      assert.equal(
        calls,
        2,
        "even a QueryClient configured to retry cannot retry the bounded follow-up",
      );
      assert.equal(followups, 1);
      assert.equal(stale, true);
      assert.equal(published.length, fails ? 1 : 2);
    } finally {
      query.clear();
    }
  }
});

void test("no active demand or a queued hard request prevents automatic soft follow-up", async () => {
  for (const hasDemand of [false, true]) {
    const query = client();
    let calls = 0;
    try {
      await refreshGitRead({
        client: query,
        queryKey: ["git", "idle", hasDemand],
        staleTime: 60_000,
        read: async () => {
          calls++;
          return { stale: true, value: "stale" };
        },
        publish: () => {},
        isCurrent: () => true,
        hasDemand: () => hasDemand,
        canFollowup: () => !hasDemand,
      });
      await tick();
      assert.equal(calls, 1);
    } finally {
      query.clear();
    }
  }
});

void test("late reads from a superseded scope cannot publish or clear the replacement scope's stale flag", async () => {
  const query = client(),
    gate = deferred<Read>();
  let current = true,
    reads = 0;
  const flags = { old: false, replacement: true };
  const seen: string[] = [];
  const reading = refreshGitRead({
    client: query,
    queryKey: ["git", "old", "repos"],
    staleTime: 60_000,
    read: async (followup) => {
      reads++;
      return followup ? gate.promise : { stale: true, value: "old-stale" };
    },
    publish: (value) => {
      flags.old = Boolean(value.stale);
      seen.push(value.value);
    },
    isCurrent: () => current,
    hasDemand: () => true,
  });
  try {
    await tick();
    assert.equal(reads, 2);
    current = false;
    gate.resolve({ value: "late-fresh" });
    await reading;
    assert.deepEqual(seen, ["old-stale"]);
    assert.deepEqual(flags, { old: true, replacement: true });
  } finally {
    gate.resolve({ value: "cleanup" });
    await reading;
    query.clear();
  }
});
