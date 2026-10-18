import assert from "node:assert/strict";
import { test } from "node:test";
import {
  NativeOperationError,
  type NativeGitProjectRepository,
  type NativeGitProjectSnapshot,
  type NativeGitProjectRepositoryResult,
} from "@nervekit/native";
import { NativeGitReadBackend } from "../../src/git/read/native-backend.js";
import { gitOperationLanes } from "../../src/git/git-operation-lanes.js";

function repository(name: string): NativeGitProjectRepository {
  return {
    relativePath: name,
    workDir: `/synthetic/${name}`,
    gitDir: `/synthetic/${name}/.git`,
    commonDir: `/synthetic/${name}/.git`,
  };
}
function snapshot(): NativeGitProjectSnapshot {
  return {
    branch: "main",
    detached: false,
    upstream: "origin/main",
    ahead: 1,
    behind: 2,
    inProgress: ["merge"],
    counts: { staged: 1, unstaged: 0, untracked: 0, ignored: 1, conflicted: 0 },
    files: [
      {
        path: "new.ts",
        renamedFrom: "old.ts",
        index: "R",
        worktree: " ",
        untracked: false,
        ignored: false,
      },
      {
        path: "generated/",
        index: "!",
        worktree: "!",
        untracked: false,
        ignored: true,
      },
    ],
  };
}
function api(rows: NativeGitProjectRepositoryResult[]) {
  return {
    discoverGitRepositories: async (root: string) => ({
      root,
      projectIsRepo: false,
      repositories: rows.map((row) => row.repository),
    }),
    readGitProjectSnapshots: async (
      repositories: NativeGitProjectRepository[],
    ) =>
      repositories.map(
        (repo) => rows.find((row) => row.repository.workDir === repo.workDir)!,
      ),
  };
}
function external(
  repo: NativeGitProjectRepository,
): NativeGitProjectRepositoryResult {
  return {
    repository: repo,
    error: {
      category: "isolation_required",
      message: "Human wording is deliberately not a discriminator",
      retryable: false,
    },
  };
}
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

void test("only selected external filters use isolation; normal/error results retain ordering and identity", async () => {
  const normal = repository("normal");
  const filter = repository("filter");
  const other = repository("other");
  const corrupt = repository("corrupt");
  const calls: string[] = [];
  const raw = [
    { repository: normal, snapshot: snapshot() },
    external(filter),
    {
      repository: other,
      error: {
        category: "unsupported",
        message:
          "tracked paths select an external clean/process filter; cancellable native filter execution is not supported",
        retryable: false,
      },
    },
    {
      repository: corrupt,
      error: {
        category: "corrupt",
        message: "synthetic corrupt index",
        retryable: true,
      },
    },
  ] as NativeGitProjectRepositoryResult[];
  const backend = new NativeGitReadBackend(() => 0, {
    projectApi: api(raw),
    isolatedReader: {
      read: async (repo, options) => {
        assert.equal(options?.includeIgnored, true);
        calls.push(repo.relativePath);
        return snapshot();
      },
      close: async () => {},
    },
  });
  try {
    const result = await backend.projectSnapshots(
      [normal, filter, other, corrupt],
      true,
    );
    assert.deepEqual(calls, ["filter"]);
    assert.deepEqual(
      result.map((row) => row.repository.relativePath),
      ["normal", "filter", "other", "corrupt"],
    );
    assert.equal(result[0]?.snapshot?.files[0]?.renamedFrom, "old.ts");
    assert.equal(result[1]?.snapshot?.files[0]?.staged, true);
    assert.equal(result[1]?.snapshot?.files[1]?.path, "generated");
    assert.deepEqual(result[1]?.snapshot?.inProgress, ["merge"]);
    assert.equal(result[1]?.snapshot?.branch.ahead, 1);
    assert.equal(result[2]?.error?.category, "unsupported");
    assert.equal(
      result[2]?.error?.message,
      raw[2]?.error?.message,
      "old human text never authorizes isolation without the typed diagnostic",
    );
    assert.equal(result[3]?.error?.category, "corrupt");
    assert.equal(
      raw[1]?.error?.category,
      "isolation_required",
      "do not mutate the native port's result array",
    );
  } finally {
    await backend.close();
  }
});

void test("each cancelled helper retains only its own gate through actual completion", async () => {
  const repos = [repository("cancel-a"), repository("cancel-b")];
  const rejects: ((error: unknown) => void)[] = [];
  const signals: AbortSignal[] = [];
  let ready!: () => void;
  const started = new Promise<void>((resolve) => {
    ready = resolve;
  });
  const backend = new NativeGitReadBackend(undefined, {
    projectApi: api(repos.map(external)),
    isolatedReader: {
      read: (_repo, options) =>
        new Promise((_resolve, reject) => {
          signals.push(options!.signal!);
          rejects.push(reject);
          if (rejects.length === 2) ready();
        }),
      close: async () => {},
    },
  });
  const controller = new AbortController();
  const reading = backend.projectSnapshots(repos, false, controller.signal);
  const rejected = assert.rejects(
    reading,
    (error: unknown) =>
      error instanceof NativeOperationError && error.category === "cancelled",
  );
  await started;
  let mutationRan = false;
  let mutationA = false;
  const freeA = gitOperationLanes.run(repos[0]!.commonDir, false, async () => {
    mutationA = true;
  });
  const mutation = gitOperationLanes.run(
    repos[1]!.commonDir,
    false,
    async () => {
      mutationRan = true;
    },
  );
  controller.abort();
  assert.ok(signals.every((signal) => signal.aborted));
  rejects[0]!(
    new NativeOperationError({
      category: "cancelled",
      message: "cancel",
      retryable: false,
    }),
  );
  await freeA;
  await tick();
  assert.equal(mutationA, true);
  assert.equal(mutationRan, false);
  rejects[1]!(
    new NativeOperationError({
      category: "cancelled",
      message: "cancel",
      retryable: false,
    }),
  );
  await rejected;
  await mutation;
  assert.equal(mutationRan, true);
  await backend.close();
});

void test("backend shutdown aborts and awaits helper lifetime before resolving", async () => {
  const repo = repository("shutdown");
  let signal!: AbortSignal;
  let rejectWork!: (error: unknown) => void;
  let ready!: () => void;
  const started = new Promise<void>((resolve) => {
    ready = resolve;
  });
  const helper = new Promise<NativeGitProjectSnapshot>((_resolve, reject) => {
    rejectWork = reject;
  });
  let closeCalled = false;
  const backend = new NativeGitReadBackend(undefined, {
    projectApi: api([external(repo)]),
    isolatedReader: {
      read: (_repo, options) => {
        signal = options!.signal!;
        ready();
        return helper;
      },
      close: async () => {
        closeCalled = true;
        await helper.catch(() => {});
      },
    },
  });
  const reading = backend.projectSnapshots([repo]);
  const rejected = assert.rejects(reading);
  await started;
  let closed = false;
  const closing = backend.close().then(() => {
    closed = true;
  });
  await tick();
  assert.equal(signal.aborted, true);
  assert.equal(closeCalled, true);
  assert.equal(closed, false);
  rejectWork(
    new NativeOperationError({
      category: "cancelled",
      message: "cancel",
      retryable: false,
    }),
  );
  await Promise.all([rejected, closing]);
  assert.equal(closed, true);
  await assert.rejects(async () => backend.projectSnapshots([repo]), /closed/);
});

void test("isolated helper failures stay per-repository and sanitized", async () => {
  const repo = repository("failure");
  const backend = new NativeGitReadBackend(undefined, {
    projectApi: api([external(repo)]),
    isolatedReader: {
      read: async () => {
        throw new NativeOperationError({
          category: "limit_exceeded",
          retryable: true,
          message: "token=synthetic-secret",
        });
      },
      close: async () => {},
    },
  });
  try {
    const [result] = await backend.projectSnapshots([repo]);
    assert.equal(result?.error?.category, "limit_exceeded");
    assert.equal(result?.error?.retryable, true);
    assert.doesNotMatch(result?.error?.message ?? "", /token|secret/);
    assert.equal(result?.snapshot, undefined);
  } finally {
    await backend.close();
  }
});

void test("busy B never holds A while a project refresh waits for B admission", async () => {
  const a = repository("busy-test-a");
  const b = repository("busy-test-b");
  let releaseB!: () => void;
  const holdB = new Promise<void>((resolve) => {
    releaseB = resolve;
  });
  let startedB!: () => void;
  const readyB = new Promise<void>((resolve) => {
    startedB = resolve;
  });
  const busy = gitOperationLanes.run(b.commonDir, true, async () => {
    startedB();
    await holdB;
  });
  await readyB;
  let readA!: () => void;
  const aRead = new Promise<void>((resolve) => {
    readA = resolve;
  });
  const batches: string[][] = [];
  const backend = new NativeGitReadBackend(undefined, {
    projectApi: {
      ...api([]),
      readGitProjectSnapshots: async (repos) => {
        batches.push(repos.map((repo) => repo.relativePath));
        if (repos.some((repo) => repo.workDir === a.workDir)) readA();
        return repos.map((repo) => ({
          repository: repo,
          snapshot: snapshot(),
        }));
      },
    },
    isolatedReader: {
      read: async () => {
        assert.fail("normal read selected helper");
      },
      close: async () => {},
    },
  });
  const refresh = backend.projectSnapshots([a, b]);
  try {
    await aRead;
    let mutationA = false;
    await gitOperationLanes.run(a.commonDir, true, async () => {
      mutationA = true;
    });
    assert.equal(mutationA, true);
    assert.deepEqual(
      batches,
      [[a.relativePath]],
      "busy B was never passed into A's native batch",
    );
    releaseB();
    await busy;
    const results = await refresh;
    assert.deepEqual(
      results.map((result) => result.repository.relativePath),
      [a.relativePath, b.relativePath],
    );
  } finally {
    releaseB();
    await busy;
    await refresh.catch(() => {});
    await backend.close();
  }
});

void test("ready native heads batch together but helper B retains ONLY B after native completion", async () => {
  const a = repository("helper-hol-a");
  const b = repository("helper-hol-b");
  let release!: (value: NativeGitProjectSnapshot) => void;
  const helper = new Promise<NativeGitProjectSnapshot>((resolve) => {
    release = resolve;
  });
  let ready!: () => void;
  const started = new Promise<void>((resolve) => {
    ready = resolve;
  });
  const batches: string[][] = [];
  const backend = new NativeGitReadBackend(undefined, {
    projectApi: {
      ...api([]),
      readGitProjectSnapshots: async (repos) => {
        batches.push(repos.map((repo) => repo.relativePath));
        return repos.map((repo) =>
          repo.workDir === b.workDir
            ? external(repo)
            : { repository: repo, snapshot: snapshot() },
        );
      },
    },
    isolatedReader: {
      read: () => {
        ready();
        return helper;
      },
      close: async () => {
        await helper;
      },
    },
  });
  const refresh = backend.projectSnapshots([a, b]);
  try {
    await started;
    await gitOperationLanes.run(a.commonDir, true, async () => {});
    assert.deepEqual(
      batches,
      [[a.relativePath, b.relativePath]],
      "only ready lane heads share the native call",
    );
    let mutationB = false;
    const blockedB = gitOperationLanes.run(b.commonDir, true, async () => {
      mutationB = true;
    });
    await tick();
    assert.equal(mutationB, false);
    release(snapshot());
    await refresh;
    await blockedB;
    assert.equal(mutationB, true);
  } finally {
    release(snapshot());
    await refresh.catch(() => {});
    await backend.close();
  }
});

void test("cancellation never releases ready-head lanes before the real native batch completes", async () => {
  const repos = [repository("native-cancel-a"), repository("native-cancel-b")];
  let finish!: (rows: NativeGitProjectRepositoryResult[]) => void;
  const native = new Promise<NativeGitProjectRepositoryResult[]>((resolve) => {
    finish = resolve;
  });
  let started!: () => void;
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  let nativeSignal!: AbortSignal;
  const backend = new NativeGitReadBackend(undefined, {
    projectApi: {
      ...api([]),
      readGitProjectSnapshots: (_repos, options) => {
        nativeSignal = options!.signal!;
        started();
        return native;
      },
    },
    isolatedReader: {
      read: async () => {
        assert.fail("normal read used helper");
      },
      close: async () => {},
    },
  });
  const controller = new AbortController();
  const reading = backend.projectSnapshots(repos, false, controller.signal);
  const rejected = assert.rejects(reading);
  try {
    await ready;
    controller.abort();
    assert.equal(nativeSignal.aborted, true);
    let mutations = 0;
    const queued = repos.map((repo) =>
      gitOperationLanes.run(repo.commonDir, true, async () => {
        mutations++;
      }),
    );
    await tick();
    assert.equal(mutations, 0);
    finish(repos.map((repo) => ({ repository: repo, snapshot: snapshot() })));
    await rejected;
    await Promise.all(queued);
    assert.equal(mutations, 2);
  } finally {
    finish(repos.map((repo) => ({ repository: repo, snapshot: snapshot() })));
    await reading.catch(() => {});
    await backend.close();
  }
});

void test("capacity retry retains cancelled batch members until actual completion without stranding surviving readers", async () => {
  const a = repository("capacity-cancel-a"),
    b = repository("capacity-cancel-b");
  const controller = new AbortController();
  let started!: () => void;
  const firstAttempt = new Promise<void>((resolve) => {
    started = resolve;
  });
  let calls = 0;
  const backend = new NativeGitReadBackend(undefined, {
    projectApi: {
      ...api([]),
      readGitProjectSnapshots: async (repositories) => {
        calls++;
        if (calls === 1) {
          started();
          throw new NativeOperationError({
            category: "limit_exceeded",
            retryable: true,
            message: "monitor owns capacity",
          });
        }
        assert.deepEqual(
          repositories.map((repo) => repo.relativePath),
          [a.relativePath, b.relativePath],
        );
        return repositories.map((repository) => ({
          repository,
          snapshot: snapshot(),
        }));
      },
    },
    isolatedReader: {
      read: async () => {
        assert.fail("normal reads selected helper");
      },
      close: async () => {},
    },
  });
  const cancelled = backend.projectSnapshots([a], false, controller.signal);
  const rejected = assert.rejects(cancelled, { name: "AbortError" });
  const surviving = backend.projectSnapshots([b]);
  try {
    await firstAttempt;
    controller.abort();
    assert.equal((await surviving)[0]?.snapshot?.branch.head, "main");
    await rejected;
    assert.equal(calls, 2);
  } finally {
    controller.abort();
    await Promise.allSettled([cancelled, surviving]);
    await backend.close();
  }
});

void test("discovery and ready batches share the native cap and queued cancellation never invokes native", async () => {
  const repo = repository("native-budget");
  let active = 0;
  let peak = 0;
  let discoveryCalls = 0;
  let finishDiscovery!: () => void;
  let finishBatch!: () => void;
  let discoveryStarted!: () => void;
  const one = new Promise<void>((resolve) => {
    discoveryStarted = resolve;
  });
  let batchStarted!: () => void;
  const two = new Promise<void>((resolve) => {
    batchStarted = resolve;
  });
  const backend = new NativeGitReadBackend(undefined, {
    projectApi: {
      discoverGitRepositories: (root) => {
        discoveryCalls++;
        peak = Math.max(peak, ++active);
        discoveryStarted();
        return new Promise((resolve) => {
          finishDiscovery = () => {
            active--;
            resolve({ root, projectIsRepo: false, repositories: [] });
          };
        });
      },
      readGitProjectSnapshots: () => {
        peak = Math.max(peak, ++active);
        batchStarted();
        return new Promise((resolve) => {
          finishBatch = () => {
            active--;
            resolve([{ repository: repo, snapshot: snapshot() }]);
          };
        });
      },
    },
    isolatedReader: {
      read: async () => {
        assert.fail("normal read used helper");
      },
      close: async () => {},
    },
  });
  const first = backend.discoverProject("/synthetic/native-budget");
  await one;
  const second = backend.projectSnapshots([repo]);
  await two;
  try {
    const abort = new AbortController();
    const queued = backend.discoverProject("/synthetic/queued", abort.signal);
    const rejected = assert.rejects(queued);
    await tick();
    assert.equal(discoveryCalls, 1);
    assert.equal(peak, 2);
    abort.abort();
    await rejected;
    assert.equal(discoveryCalls, 1);
    finishDiscovery();
    finishBatch();
    await Promise.all([first, second]);
  } finally {
    if (active) {
      finishDiscovery();
      finishBatch();
    }
    await Promise.allSettled([first, second]);
    await backend.close();
  }
});
