import assert from "node:assert/strict";
import { mkdtemp, mkdir, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, toNamespacedPath } from "node:path";
import { test } from "node:test";
import type {
  NativeGitMetadataSnapshot,
  NativeGitProjectSnapshot,
} from "@nervekit/native";
import { NativeGitReadBackend } from "../../src/git/read/native-backend.js";
import { inGitLane } from "../../src/git/git-operation-context.js";
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
const light = (): NativeGitProjectSnapshot => ({
  headOid: "status-head",
  branch: "main",
  detached: false,
  files: [
    {
      path: "changed",
      index: " ",
      worktree: "M",
      untracked: false,
      ignored: false,
    },
  ],
  counts: { staged: 0, unstaged: 1, untracked: 0, ignored: 0, conflicted: 0 },
  inProgress: [],
});
function metadata(root: string): NativeGitMetadataSnapshot {
  return {
    gitDir: join(root, ".git"),
    workDir: root,
    headOid: "metadata-head",
    headBranch: "main",
    detached: false,
    inProgress: [],
    refs: [{ name: "refs/heads/main", target: "metadata-head" }],
    remotes: [{ name: "origin", fetchUrl: "https://example.invalid/repo" }],
    recentCommits: [
      { oid: "123456789", subject: "subject", timestampSeconds: 0 },
    ],
    stashes: [
      { index: 0, oid: "stash-oid", message: "stash", timestampSeconds: 0 },
    ],
  };
}
async function fixture() {
  const temporary = await mkdtemp(join(tmpdir(), "nerve-detailed-read-"));
  const root = await realpath(temporary);
  const a = join(root, "a");
  const b = join(root, "b");
  await Promise.all([
    mkdir(join(a, ".git"), { recursive: true }),
    mkdir(join(b, ".git"), { recursive: true }),
  ]);
  return {
    root,
    a,
    b,
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}

void test("full reads compose status-free metadata and selected-filter helper under one repository lane", async () => {
  const f = await fixture();
  let release!: (snapshot: NativeGitProjectSnapshot) => void;
  let ready!: () => void;
  const started = new Promise<void>((resolve) => {
    ready = resolve;
  });
  const steps: string[] = [];
  const backend = new NativeGitReadBackend(() => 1000, {
    metadataApi: {
      readGitMetadataSnapshot: async (path, options) => {
        assert.equal(path, f.a);
        assert.equal(options?.recentCommitLimit, 10);
        assert.equal(options?.stashLimit, 1000);
        steps.push("metadata");
        return metadata(f.a);
      },
    },
    projectApi: {
      discoverGitRepositories: async () => {
        throw new Error("full reads must not recursively discover a project");
      },
      readGitProjectSnapshots: async (repositories) => {
        assert.deepEqual(repositories, [
          {
            relativePath: ".",
            workDir: toNamespacedPath(f.a),
            gitDir: toNamespacedPath(join(f.a, ".git")),
            commonDir: toNamespacedPath(join(f.a, ".git")),
          },
        ]);
        steps.push("guarded-status");
        return repositories.map((repository) => ({
          repository,
          error: {
            category: "isolation_required",
            message: "typed selection",
            retryable: false,
          },
        }));
      },
    },
    isolatedReader: {
      read: async () => {
        steps.push("helper");
        ready();
        return new Promise((resolve) => {
          release = resolve;
        });
      },
      close: async () => {},
    },
  });
  const reading = backend.snapshot(f.a);
  let competing: Promise<void> | undefined;
  try {
    await started;
    competing = inGitLane(f.a, true, async () => {
      steps.push("same-repo-mutation");
    });
    await inGitLane(f.b, true, async () => {
      steps.push("other-repo-mutation");
    });
    assert.deepEqual(steps, [
      "metadata",
      "guarded-status",
      "helper",
      "other-repo-mutation",
    ]);
    release(light());
    const result = await reading;
    await competing;
    assert.equal(result.headOid, "status-head");
    assert.equal(result.files[0]?.path, "changed");
    assert.equal(result.refs[0]?.name, "refs/heads/main");
    assert.equal(result.remotes[0]?.name, "origin");
    assert.equal(result.recentCommits[0]?.hash, "1234567");
    assert.equal(result.stashes[0]?.ref, "stash@{0}");
    assert.equal(steps.at(-1), "same-repo-mutation");
  } finally {
    release?.(light());
    await reading.catch(() => {});
    await competing;
    await backend.close();
    await f.cleanup();
  }
});

void test("full composition rejects metadata identity mismatch before any status or helper call", async () => {
  const f = await fixture();
  let statusCalls = 0;
  const backend = new NativeGitReadBackend(undefined, {
    metadataApi: { readGitMetadataSnapshot: async () => metadata(f.b) },
    projectApi: {
      discoverGitRepositories: async () => {
        throw new Error("not used");
      },
      readGitProjectSnapshots: async () => {
        statusCalls++;
        return [];
      },
    },
    isolatedReader: {
      read: async () => {
        assert.fail("mismatched metadata reached helper");
      },
      close: async () => {},
    },
  });
  try {
    await assert.rejects(backend.snapshot(f.a), /identity changed/);
    assert.equal(statusCalls, 0);
  } finally {
    await backend.close();
    await f.cleanup();
  }
});

void test("metadata-only reads share native admission with discovery and never request status/history/stashes", async () => {
  const f = await fixture();
  const releases: (() => void)[] = [];
  let metadataCalls = 0;
  const backend = new NativeGitReadBackend(undefined, {
    metadataApi: {
      readGitMetadataSnapshot: async (_path, options) => {
        metadataCalls++;
        assert.equal(options?.recentCommitLimit, undefined);
        assert.equal(options?.stashLimit, undefined);
        assert.ok(options?.signal);
        return metadata(f.a);
      },
    },
    projectApi: {
      discoverGitRepositories: async (root) => {
        await new Promise<void>((resolve) => {
          releases.push(resolve);
        });
        return { root, projectIsRepo: false, repositories: [] };
      },
      readGitProjectSnapshots: async () => {
        assert.fail("metadata requested status");
      },
    },
    isolatedReader: {
      read: async () => {
        assert.fail("metadata requested a filter helper");
      },
      close: async () => {},
    },
  });
  const first = backend.discoverProject("/synthetic/one");
  const second = backend.discoverProject("/synthetic/two");
  const reading = backend.metadata(f.a);
  try {
    while (releases.length < 2) await tick();
    await tick();
    assert.equal(metadataCalls, 0);
    releases[0]!();
    const result = await reading;
    assert.equal(result.remotes.length, 1);
    assert.equal("files" in result, false);
    assert.equal(metadataCalls, 1);
  } finally {
    for (const release of releases) release();
    await Promise.allSettled([first, second, reading]);
    await backend.close();
    await f.cleanup();
  }
});

void test("shutdown keeps the composed-read lane until isolated status actually closes", async () => {
  const f = await fixture();
  let release!: (snapshot: NativeGitProjectSnapshot) => void;
  let ready!: () => void;
  let signal!: AbortSignal;
  const started = new Promise<void>((resolve) => {
    ready = resolve;
  });
  const backend = new NativeGitReadBackend(undefined, {
    metadataApi: { readGitMetadataSnapshot: async () => metadata(f.a) },
    projectApi: {
      discoverGitRepositories: async () => {
        throw new Error("not used");
      },
      readGitProjectSnapshots: async (repositories) =>
        repositories.map((repository) => ({
          repository,
          error: {
            category: "isolation_required",
            message: "filter",
            retryable: false,
          },
        })),
    },
    isolatedReader: {
      read: async (_repository, options) => {
        signal = options!.signal!;
        ready();
        return new Promise((resolve) => {
          release = resolve;
        });
      },
      close: async () => {},
    },
  });
  const reading = backend.snapshot(f.a);
  const rejected = assert.rejects(reading, { name: "AbortError" });
  await started;
  let ran = false;
  const mutation = inGitLane(f.a, false, async () => {
    ran = true;
  });
  let closed = false;
  const closing = backend.close().then(() => {
    closed = true;
  });
  try {
    await tick();
    assert.equal(signal.aborted, true);
    assert.equal(ran, false);
    assert.equal(closed, false);
    release(light());
    await Promise.all([rejected, mutation, closing]);
    assert.equal(ran, true);
    assert.equal(closed, true);
  } finally {
    release(light());
    await Promise.allSettled([reading, mutation, closing]);
    await f.cleanup();
  }
});
