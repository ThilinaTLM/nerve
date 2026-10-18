import assert from "node:assert/strict";
import { mkdtemp, mkdir, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  GitOperationService,
  type GitActivityPort,
  type GitActivityHandle,
  type GitOperationRepositoryPort,
} from "../../src/git/git-operations.js";
import {
  currentGitCommandOptions,
  inGitLane,
  inGitReadLane,
} from "../../src/git/git-operation-context.js";

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
async function until(predicate: () => boolean) {
  for (let i = 0; i < 100; i++) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  assert.fail("condition did not settle");
}
function reporter() {
  const entries = new Map<
    string,
    {
      parentId?: string;
      status: string;
      terminals: number;
      error?: string;
      cancel?: () => void;
      finished: Promise<void>;
    }
  >();
  const port: GitActivityPort = {
    start(input, actions) {
      const id = input.id ?? `test-${entries.size}`;
      let finishEntry!: () => void;
      const finished = new Promise<void>((resolve) => {
        finishEntry = resolve;
      });
      const entry = {
        finished,
        parentId: input.parentId,
        status: input.status ?? "running",
        terminals: 0,
        error: undefined as string | undefined,
        cancel: actions?.cancel,
      };
      entries.set(id, entry);
      const finish = (status: string) => {
        entry.terminals++;
        entry.status = status;
        finishEntry();
      };
      const handle: GitActivityHandle = {
        id,
        progress(patch) {
          if (patch.status) entry.status = patch.status;
        },
        succeed: () => finish("succeeded"),
        fail(error) {
          entry.error = error.message;
          finish("failed");
        },
        cancelled: () => finish("cancelled"),
        interrupt: () => finish("interrupted"),
      };
      return handle;
    },
  };
  return { port, entries };
}
async function fixture(
  run: (repo: string) => Promise<never>,
  deadlineMs?: number,
) {
  const root = await mkdtemp(join(tmpdir(), "nerve-operations-"));
  for (const repo of ["a", "b"])
    await mkdir(join(root, repo, ".git"), { recursive: true });
  const report = reporter();
  let changed = 0;
  const git: GitOperationRepositoryPort = {
    getProject: () => ({ dir: root, name: "Synthetic project" }),
    resolveRepoDir: (_project, repo) => join(root, repo),
    fetch: (_project, repo) => run(repo),
    pull: (_project, repo) => run(repo),
    push: (_project, repo) => run(repo),
    syncBranch: (_project, repo) => run(repo),
    switchBaseAndPull: (_project, repo) => run(repo),
    checkoutPr: (_project, repo) => run(repo),
    clone: (_project, repo) => run(repo),
    async closeRemoteCaches() {},
  };
  const service = new GitOperationService(
    git,
    report.port,
    () => {
      changed++;
    },
    deadlineMs,
  );
  return {
    ...report,
    service,
    get changed() {
      return changed;
    },
    async cleanup() {
      await service.close();
      await rm(root, { recursive: true, force: true });
    },
  };
}

for (const kind of ["fetch", "pull", "switchBaseAndPull"] as const) {
  test(`${kind}: background IDs precede completion; bulk children report partial failure independently`, async () => {
    const f = await fixture(async (repo) => {
      if (repo === "b") throw new Error("https://token:secret@remote.invalid");
      return {} as never;
    });
    try {
      const result = f.service.startBulk({
        projectId: "p",
        repos: ["a", "b"],
        kind,
      });
      assert.equal(result.childOperationIds.length, 2);
      assert.equal(f.entries.get(result.operationId)?.status, "running");
      await until(() => f.entries.get(result.operationId)?.status === "failed");
      assert.deepEqual(
        result.childOperationIds.map((id) => f.entries.get(id)?.status),
        ["succeeded", "failed"],
      );
      assert.equal(f.changed, 1);
      for (const id of result.childOperationIds)
        assert.equal(f.entries.get(id)?.parentId, result.operationId);
      assert.equal(f.service.cancel(result.operationId).accepted, false);
      assert.equal(f.service.cancel("missing").accepted, false);
      for (const entry of f.entries.values()) {
        assert.equal(entry.terminals, 1);
        assert.doesNotMatch(entry.error ?? "", /secret|token|remote.invalid/);
      }
    } finally {
      await f.cleanup();
    }
  });

  test(`${kind}: bulk cancellation affects only children and parent waits until children close`, async () => {
    const releases: (() => void)[] = [];
    const f = await fixture(
      () =>
        new Promise<never>((_resolve, reject) => {
          const signal = currentGitCommandOptions().signal!;
          signal.addEventListener(
            "abort",
            () => {
              releases.push(() =>
                reject(new DOMException("cancel", "AbortError")),
              );
            },
            { once: true },
          );
        }),
    );
    try {
      const bulk = f.service.startBulk({
        projectId: "p",
        repos: ["a"],
        kind,
      });
      const other = f.service.start({
        projectId: "p",
        repo: "b",
        kind: "fetch",
      });
      await until(
        () =>
          bulk.childOperationIds.every(
            (id) => f.entries.get(id)?.status === "running",
          ) && f.entries.get(other.operationId)?.status === "running",
      );
      assert.equal(f.service.cancel(bulk.operationId).accepted, true);
      await tick();
      assert.equal(releases.length, 1);
      assert.equal(f.entries.get(bulk.operationId)?.status, "running");
      releases[0]!();
      await until(
        () => f.entries.get(bulk.operationId)?.status === "cancelled",
      );
      assert.equal(f.entries.get(other.operationId)?.status, "running");
      f.entries.get(other.operationId)?.cancel?.();
      releases[1]!();
      await until(
        () => f.entries.get(other.operationId)?.status === "cancelled",
      );
      for (const entry of f.entries.values()) assert.equal(entry.terminals, 1);
    } finally {
      await f.cleanup();
    }
  });
}

void test("bulk switch-base dispatches each repository's default-base workflow once with the child's lane and cancellation context", async () => {
  const f = await fixture(async () => {
    assert.fail("bulk switch-base must not dispatch fetch or pull directly");
  });
  const calls: { repo: string; baseBranch?: string; activityId?: string }[] =
    [];
  f.service.git.switchBaseAndPull = async (projectId, repo, baseBranch) => {
    const options = currentGitCommandOptions();
    assert.ok(options.signal);
    assert.ok(options.deadlineAt);
    return inGitLane(
      f.service.git.resolveRepoDir(projectId, repo),
      true,
      async () => {
        assert.equal(currentGitCommandOptions().signal, options.signal);
        assert.equal(currentGitCommandOptions().activityId, options.activityId);
        calls.push({ repo, baseBranch, activityId: options.activityId });
        return {} as never;
      },
    );
  };
  try {
    const bulk = f.service.startBulk({
      projectId: "p",
      repos: ["a", "b", "a"],
      kind: "switchBaseAndPull",
    });
    await until(() => f.entries.get(bulk.operationId)?.status === "succeeded");
    assert.equal(bulk.childOperationIds.length, 2);
    assert.deepEqual(calls.map(({ repo }) => repo).sort(), ["a", "b"]);
    assert.ok(calls.every(({ baseBranch }) => baseBranch === undefined));
    assert.deepEqual(
      calls.map(({ activityId }) => activityId).sort(),
      [...bulk.childOperationIds].sort(),
    );
    assert.equal(f.changed, 2);
    for (const entry of f.entries.values()) assert.equal(entry.terminals, 1);
  } finally {
    await f.cleanup();
  }
});

void test("bulk cancellation removes a queued child but retains the active child lane until actual completion", async () => {
  let releaseActive: (() => void) | undefined;
  const invoked: string[] = [];
  const f = await fixture(
    (repo) =>
      new Promise<never>((_resolve, reject) => {
        invoked.push(repo);
        const signal = currentGitCommandOptions().signal!;
        signal.addEventListener(
          "abort",
          () => {
            releaseActive = () => reject(signal.reason);
          },
          { once: true },
        );
      }),
  );
  let releaseBlocker!: () => void;
  let blockerStarted!: () => void;
  const ready = new Promise<void>((resolve) => {
    blockerStarted = resolve;
  });
  const hold = new Promise<void>((resolve) => {
    releaseBlocker = resolve;
  });
  const blocked = inGitLane(
    f.service.git.resolveRepoDir("p", "b"),
    false,
    async () => {
      blockerStarted();
      await hold;
    },
  );
  await ready;
  try {
    const bulk = f.service.startBulk({
      projectId: "p",
      repos: ["a", "b"],
      kind: "pull",
    });
    const [activeId, queuedId] = bulk.childOperationIds;
    await until(() => invoked.length === 1);
    assert.deepEqual(invoked, ["a"]);
    assert.equal(f.entries.get(queuedId!)?.status, "queued");
    assert.equal(f.service.cancel(bulk.operationId).accepted, true);
    await until(() => f.entries.get(queuedId!)?.status === "cancelled");
    assert.equal(f.entries.get(bulk.operationId)?.status, "running");
    assert.equal(f.entries.get(activeId!)?.status, "running");
    let statusRan = false;
    const status = inGitLane(
      f.service.git.resolveRepoDir("p", "a"),
      false,
      async () => {
        statusRan = true;
      },
    );
    await tick();
    assert.equal(statusRan, false);
    assert.ok(releaseActive);
    releaseActive();
    await status;
    await until(() => f.entries.get(bulk.operationId)?.status === "cancelled");
    releaseBlocker();
    await blocked;
    assert.deepEqual(invoked, ["a"], "cancelled queued child never executes");
    for (const id of [bulk.operationId, ...bulk.childOperationIds])
      assert.equal(f.entries.get(id)?.terminals, 1);
  } finally {
    const closing = f.service.close();
    releaseActive?.();
    releaseBlocker();
    await Promise.all([blocked, closing]);
    await f.cleanup();
  }
});

void test("tracked PR checkout reenters workflow and status lanes without admitting competing same-repo status", async () => {
  let release!: () => void;
  const hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  // Bound event waits without relying on a fixed number of short timer spins.
  async function waitFor<T>(event: Promise<T>, label: string): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        event,
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(
            () => reject(new Error(`Timed out: ${label}`)),
            10_000,
          );
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
  let reachedFetch!: () => void;
  const fetching = new Promise<void>((resolve) => {
    reachedFetch = resolve;
  });
  const steps: string[] = [];
  const f = await fixture(async (repo) => {
    const cwd = f.service.git.resolveRepoDir("p", repo);
    // Discovered read descriptors use real filesystem identities, not raw paths
    // (Windows temp paths can differ in casing or canonical representation).
    const commonDir = await realpath(join(cwd, ".git"));
    return inGitLane(cwd, true, async () => {
      await inGitReadLane(commonDir, async () => {
        steps.push("dirty-guard");
      });
      await inGitLane(cwd, true, async () => {
        steps.push("fetch");
        reachedFetch();
      });
      await hold;
      await inGitReadLane(commonDir, async () => {
        steps.push("ref-refresh");
      });
      await inGitLane(cwd, false, async () => {
        steps.push("switch");
      });
      return {} as never;
    });
  });
  let competing: Promise<void> | undefined;
  try {
    const { operationId } = f.service.start({
      projectId: "p",
      repo: "a",
      kind: "checkout",
      number: 42,
    });
    const entry = f.entries.get(operationId)!;
    await waitFor(
      Promise.race([
        fetching,
        entry.finished.then(() => {
          assert.fail(
            `Checkout ended before fetch: ${entry.status}: ${entry.error ?? ""}`,
          );
        }),
      ]),
      "checkout reaches fetch",
    );
    competing = inGitLane(
      f.service.git.resolveRepoDir("p", "a"),
      false,
      async () => {
        steps.push("competing-status");
      },
    );
    await inGitLane(f.service.git.resolveRepoDir("p", "b"), true, async () => {
      steps.push("unrelated-fetch");
    });
    assert.deepEqual(steps, ["dirty-guard", "fetch", "unrelated-fetch"]);
    release();
    await competing;
    await waitFor(entry.finished, "checkout completes");
    assert.equal(entry.status, "succeeded", entry.error);
    assert.deepEqual(steps, [
      "dirty-guard",
      "fetch",
      "unrelated-fetch",
      "ref-refresh",
      "switch",
      "competing-status",
    ]);
    assert.equal(f.entries.get(operationId)?.terminals, 1);
  } finally {
    release();
    await competing;
    await f.cleanup();
  }
});

void test("shutdown rejects cancellation races and waits for interrupted children", async () => {
  let rejectRun!: (error: unknown) => void;
  const f = await fixture(
    () =>
      new Promise<never>((_resolve, reject) => {
        rejectRun = reject;
      }),
  );
  try {
    const { operationId } = f.service.start({
      projectId: "p",
      repo: "a",
      kind: "fetch",
    });
    await until(() => f.entries.get(operationId)?.status === "running");
    const closing = f.service.close();
    assert.equal(f.service.cancel(operationId).accepted, false);
    assert.throws(
      () => f.service.start({ projectId: "p", repo: "a", kind: "fetch" }),
      /shutting down/,
    );
    rejectRun(new DOMException("stopped", "AbortError"));
    await closing;
    assert.equal(f.entries.get(operationId)?.status, "interrupted");
    assert.equal(f.entries.get(operationId)?.terminals, 1);
    assert.equal(f.service.cancel(operationId).accepted, false);
  } finally {
    await f.cleanup();
  }
});

void test("actual successful exit wins shutdown/cancel race and publishes success once", async () => {
  let resolveRun!: (value: never) => void;
  const f = await fixture(
    () =>
      new Promise<never>((resolve) => {
        resolveRun = resolve;
      }),
  );
  try {
    const { operationId } = f.service.start({
      projectId: "p",
      repo: "a",
      kind: "push",
    });
    await until(() => f.entries.get(operationId)?.status === "running");
    f.service.cancel(operationId);
    const closing = f.service.close();
    resolveRun({} as never);
    await closing;
    assert.equal(f.entries.get(operationId)?.status, "succeeded");
    assert.equal(f.entries.get(operationId)?.terminals, 1);
    assert.equal(f.changed, 1);
  } finally {
    await f.cleanup();
  }
});

void test("one total workflow deadline is shared by commands and reports timeout rather than cancellation", async () => {
  let observedDeadline: number | undefined;
  const f = await fixture(
    () =>
      new Promise<never>((_resolve, reject) => {
        const options = currentGitCommandOptions();
        observedDeadline = options.deadlineAt;
        options.signal!.addEventListener(
          "abort",
          () => reject(options.signal!.reason),
          { once: true },
        );
      }),
    10,
  );
  try {
    const { operationId } = f.service.start({
      projectId: "p",
      repo: "a",
      kind: "sync",
    });
    await until(() => f.entries.get(operationId)?.status === "failed");
    assert.equal(typeof observedDeadline, "number");
    assert.match(f.entries.get(operationId)?.error ?? "", /total deadline/);
    assert.equal(f.entries.get(operationId)?.terminals, 1);
    assert.equal(f.service.cancel(operationId).accepted, false);
  } finally {
    await f.cleanup();
  }
});

void test("bulk aggregation preserves actual child success during shutdown", async () => {
  const releases: (() => void)[] = [];
  const f = await fixture(
    () =>
      new Promise<never>((resolve) => {
        releases.push(() => resolve({} as never));
      }),
  );
  try {
    const bulk = f.service.startBulk({
      projectId: "p",
      repos: ["a", "b"],
      kind: "fetch",
    });
    await until(() => releases.length === 2);
    const closing = f.service.close();
    for (const release of releases) release();
    await closing;
    assert.equal(f.entries.get(bulk.operationId)?.status, "succeeded");
    assert.equal(f.entries.get(bulk.operationId)?.terminals, 1);
    assert.equal(f.service.cancel(bulk.operationId).accepted, false);
  } finally {
    await f.cleanup();
  }
});
