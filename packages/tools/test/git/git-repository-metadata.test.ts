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
  const rejected = assert.rejects(old, { name: "AbortError" });
  cache.invalidateWithin(root);
  assert.equal(signals[1]!.aborted, true);
  const fresh = cache.get(root);
  releases[2]!();
  assert.equal((await fresh).baseBranch, "main");
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
  releases[1]!();
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
