import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { GitRepositoryMetadataCache } from "../../src/git/git-repository-metadata.js";
import type { GitService } from "../../src/git/git-service.js";
import type {
  GitReadSnapshot,
  GitReadMetadataSnapshot,
} from "../../src/git/read/types.js";
import {
  currentGitCommandOptions,
  inGitLane,
} from "../../src/git/git-operation-context.js";

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
function metadata(): GitReadMetadataSnapshot {
  return {
    headOid: null,
    branch: {
      head: "main",
      detached: false,
      upstream: null,
      ahead: null,
      behind: null,
    },
    refs: [],
    remotes: [],
    recentCommits: [],
    stashes: [],
  };
}

void test("workflow metadata cancellation cannot poison an independent shared cache query or borrow its lane", async () => {
  const root = await mkdtemp(join(tmpdir(), "nerve-metadata-owner-"));
  await mkdir(join(root, ".git"));
  const signals: AbortSignal[] = [];
  const inherited: (AbortSignal | undefined)[] = [];
  const releases: (() => void)[] = [];
  const cache = new GitRepositoryMetadataCache(
    {
      readMetadataSnapshot: async (_path, options) => {
        const signal = options!.signal!;
        signals.push(signal);
        inherited.push(currentGitCommandOptions().signal);
        return new Promise<GitReadMetadataSnapshot>((resolve, reject) => {
          const abort = () => reject(signal.reason);
          signal.addEventListener("abort", abort, { once: true });
          releases.push(() => {
            signal.removeEventListener("abort", abort);
            resolve(metadata());
          });
        });
      },
    },
    100,
    () => 0,
  );
  const caller = new AbortController();
  const workflow = inGitLane(root, false, () => cache.get(root), {
    signal: caller.signal,
  });
  const cancelled = assert.rejects(workflow, { name: "AbortError" });
  try {
    while (!signals.length) await tick();
    const shared = cache.get(root);
    assert.equal(cache.get(root), shared);
    assert.equal(signals.length, 2);
    assert.equal(inherited[0], caller.signal);
    assert.equal(
      inherited[1],
      undefined,
      "the shared cache owns its load outside the first workflow ALS scope",
    );
    caller.abort();
    await cancelled;
    assert.equal(signals[0]!.aborted, true);
    assert.equal(signals[1]!.aborted, false);
    releases[1]!();
    assert.equal((await shared).baseBranch, "main");
    assert.equal(signals.length, 2);
  } finally {
    caller.abort();
    for (const release of releases) release();
    await cancelled;
    await cache.close();
    await rm(root, { recursive: true, force: true });
  }
});

void test(
  "an unsignalled workflow bypasses shared metadata queued behind its own lane",
  { timeout: 2000 },
  async () => {
    const root = await mkdtemp(join(tmpdir(), "nerve-metadata-unsignalled-"));
    await mkdir(join(root, ".git"));
    const events: string[] = [];
    const cache = new GitRepositoryMetadataCache(
      {
        readMetadataSnapshot: (path, options) =>
          inGitLane(
            path,
            false,
            async () => {
              events.push(
                options?.signal ? "shared-metadata" : "workflow-metadata",
              );
              return metadata();
            },
            { signal: options?.signal },
          ),
      },
      100,
      () => 0,
    );
    let ready!: () => void;
    let proceed!: () => void;
    const started = new Promise<void>((resolve) => {
      ready = resolve;
    });
    const hold = new Promise<void>((resolve) => {
      proceed = resolve;
    });
    const workflow = inGitLane(root, false, async () => {
      ready();
      await hold;
      await cache.get(root);
      events.push("workflow-completed");
    });
    await started;
    const shared = cache.get(root);
    proceed();
    try {
      await Promise.all([workflow, shared]);
      assert.deepEqual(events, [
        "workflow-metadata",
        "workflow-completed",
        "shared-metadata",
      ]);
    } finally {
      proceed();
      await cache.close();
      await Promise.allSettled([workflow, shared]);
      await rm(root, { recursive: true, force: true });
    }
  },
);

void test("metadata TTL starts at completion and hard generation invalidation/shutdown await real load completion", async () => {
  let now = 0;
  const signals: AbortSignal[] = [];
  const releases: (() => void)[] = [];
  const root = resolve(tmpdir(), "nerve-metadata-generation");
  const cache = new GitRepositoryMetadataCache(
    {
      readMetadataSnapshot: (_path, options) =>
        new Promise<GitReadMetadataSnapshot>((resolve) => {
          signals.push(options!.signal!);
          releases.push(() => resolve(metadata()));
        }),
    },
    100,
    () => now,
  );
  const first = cache.get(root);
  now = 35_000;
  assert.equal(
    cache.get(root),
    first,
    "pending metadata cannot expire and restart",
  );
  releases[0]!();
  await first;
  now = 35_099;
  assert.equal(cache.get(root), first);
  now = 35_101;
  const old = cache.get(root);
  cache.invalidateWithin(root);
  assert.equal(signals[1]!.aborted, true);
  const fresh = cache.get(root);
  releases[2]!();
  const freshValue = await fresh;
  releases[1]!();
  assert.equal(
    await old,
    freshValue,
    "superseded readers join the fresh result",
  );
  cache.invalidate(root);
  const pending = cache.get(root);
  const rejected = assert.rejects(pending, { name: "AbortError" });
  let closed = false;
  const closing = cache.close().then(() => {
    closed = true;
  });
  await tick();
  assert.equal(
    closed,
    false,
    "native ignoring cancellation must still be awaited",
  );
  releases[3]!();
  await rejected;
  await closing;
  assert.equal(closed, true);
  await assert.rejects(cache.get(root), /closed/);
});

void test("project invalidation clears only that canonical root and its descendant metadata", async () => {
  const root = resolve(tmpdir(), "nerve-metadata-synthetic");
  const child = join(root, "repo");
  const sibling = join(`${root}-other`, "repo");
  const calls = new Map<string, number>();
  let now = 0;
  const service = {
    readMetadataSnapshot: async (path: string): Promise<GitReadSnapshot> => {
      calls.set(path, (calls.get(path) ?? 0) + 1);
      return {
        headOid: null,
        branch: {
          head: "main",
          detached: false,
          upstream: null,
          ahead: null,
          behind: null,
        },
        refs: [],
        remotes: [],
        files: [],
        recentCommits: [],
        stashes: [],
      };
    },
  } as unknown as GitService;
  const cache = new GitRepositoryMetadataCache(service, 100, () => now);
  const first = cache.get(child);
  assert.equal(first, cache.get(child));
  await Promise.all([first, cache.get(root), cache.get(sibling)]);
  cache.invalidateWithin(root);
  await Promise.all([cache.get(child), cache.get(root), cache.get(sibling)]);
  assert.equal(calls.get(child), 2);
  assert.equal(calls.get(root), 2);
  assert.equal(calls.get(sibling), 1);
  now = 101;
  await cache.get(sibling);
  assert.equal(calls.get(sibling), 2);
});

function controlledMetadataCache(limit = 128) {
  const reads: {
    signal: AbortSignal;
    resolve: (value: GitReadMetadataSnapshot) => void;
    reject: (error: unknown) => void;
  }[] = [];
  const cache = new GitRepositoryMetadataCache(
    {
      readMetadataSnapshot: (_path, options) =>
        new Promise<GitReadMetadataSnapshot>((resolve, reject) => {
          // Deliberately ignore cancellation to control obsolete completions.
          reads.push({ signal: options!.signal!, resolve, reject });
        }),
    },
    100,
    () => 0,
    limit,
  );
  return { cache, reads };
}

void test("shared readers follow repeated invalidation without publishing obsolete results", async () => {
  const root = resolve(tmpdir(), "nerve-metadata-repeated");
  const { cache, reads } = controlledMetadataCache();
  const first = cache.get(root);
  assert.equal(cache.get(root), first);
  let settled = false;
  void first.then(() => {
    settled = true;
  });
  for (let i = 0; i < 25; i++) {
    cache.invalidate(root);
    assert.equal(reads[i]!.signal.aborted, true);
    reads[i]!.resolve(metadata());
    await tick();
    assert.equal(settled, false, "obsolete metadata must never reach readers");
    assert.equal(
      reads.length,
      i + 2,
      "recovery starts exactly one replacement",
    );
  }
  const concurrent = cache.get(root);
  assert.equal(cache.get(root), concurrent);
  assert.equal(reads.length, 26);
  const fresh = metadata();
  fresh.branch.head = "fresh";
  reads[25]!.resolve(fresh);
  const [a, b] = await Promise.all([first, concurrent]);
  assert.equal(a, b);
  assert.equal(a.baseBranch, "fresh");
  await cache.close();
});

void test("backend errors, including AbortErrors during invalidation, are not recovered", async () => {
  const root = resolve(tmpdir(), "nerve-metadata-errors");
  for (const failure of [
    new Error("backend failed"),
    new DOMException("Git metadata superseded", "AbortError"),
  ]) {
    const { cache, reads } = controlledMetadataCache();
    const pending = cache.get(root);
    const rejected = assert.rejects(pending, (error) => error === failure);
    cache.invalidate(root);
    reads[0]!.reject(failure);
    await rejected;
    assert.equal(reads.length, 1, "a real failure must not start recovery");
    const retry = cache.get(root);
    reads[1]!.resolve(metadata());
    await retry;
    await cache.close();
  }
});

void test("a genuine replacement failure reaches all readers and remains retryable", async () => {
  const root = resolve(tmpdir(), "nerve-metadata-replacement-error");
  const { cache, reads } = controlledMetadataCache();
  const old = cache.get(root);
  cache.invalidate(root);
  const fresh = cache.get(root);
  reads[0]!.resolve(metadata());
  await tick();
  const failure = new Error("replacement failed");
  const rejected = [old, fresh].map((read) =>
    assert.rejects(read, (error) => error === failure),
  );
  reads[1]!.reject(failure);
  await Promise.all(rejected);
  assert.equal(reads.length, 2);
  const retry = cache.get(root);
  reads[2]!.resolve(metadata());
  await retry;
  await cache.close();
});

void test("close during recovery rejects shared readers and awaits the replacement load", async () => {
  const root = resolve(tmpdir(), "nerve-metadata-recovery-close");
  const { cache, reads } = controlledMetadataCache();
  const pending = cache.get(root);
  const rejected = assert.rejects(pending, { name: "AbortError" });
  cache.invalidate(root);
  reads[0]!.resolve(metadata());
  await tick();
  assert.equal(reads.length, 2);
  let closed = false;
  const closing = cache.close().then(() => {
    closed = true;
  });
  await tick();
  assert.equal(closed, false);
  assert.equal(reads[1]!.signal.aborted, true);
  reads[1]!.resolve(metadata());
  await rejected;
  await closing;
  assert.equal(reads.length, 2, "shutdown must not resurrect a generation");
  await assert.rejects(cache.get(root), /closed/);
});

void test("capacity eviction recovers pending readers while retaining shared-load deduplication", async () => {
  const root = resolve(tmpdir(), "nerve-metadata-capacity");
  const { cache, reads } = controlledMetadataCache(1);
  const evicted = cache.get(root);
  const retained = cache.get(`${root}-other`);
  assert.equal(reads[0]!.signal.aborted, true);
  assert.equal(cache.get(`${root}-other`), retained);
  reads[1]!.resolve(metadata());
  await retained;
  reads[0]!.resolve(metadata());
  await tick();
  assert.equal(reads.length, 3);
  const joined = cache.get(root);
  assert.equal(cache.get(root), joined);
  const fresh = metadata();
  fresh.branch.head = "fresh";
  reads[2]!.resolve(fresh);
  const [a, b] = await Promise.all([evicted, joined]);
  assert.equal(a, b);
  assert.equal(a.baseBranch, "fresh");
  await cache.close();
});
