import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import type { FSWatcher } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { mkdtemp } from "node:fs/promises";
import { GitRepositoryWatcher } from "../../../src/domains/git/git-repository-watcher.js";
import { PerformanceMetricsCollector } from "../../../src/infrastructure/diagnostics/performance-metrics.js";

type Timer = { at: number; callback: () => void; cancelled: boolean };

class FakeClock {
  nowMs = 0;
  timers: Timer[] = [];

  setTimeout(
    callback: () => void,
    delayMs: number,
  ): ReturnType<typeof setTimeout> {
    const timer = { at: this.nowMs + delayMs, callback, cancelled: false };
    this.timers.push(timer);
    return timer as unknown as ReturnType<typeof setTimeout>;
  }

  clearTimeout(timer: ReturnType<typeof setTimeout>): void {
    (timer as unknown as Timer).cancelled = true;
  }

  advanceTo(nowMs: number): void {
    while (true) {
      const next = this.timers
        .filter((timer) => !timer.cancelled && timer.at <= nowMs)
        .sort((left, right) => left.at - right.at)[0];
      if (!next) break;
      next.cancelled = true;
      this.nowMs = next.at;
      next.callback();
    }
    this.nowMs = nowMs;
  }
}

class FakeWatcher extends EventEmitter {
  closed = false;
  close(): void {
    this.closed = true;
  }
}

function setup(
  options: { maxRepositories?: number; publisherThrows?: boolean } = {},
) {
  const clock = new FakeClock();
  const watches: Array<{
    path: string;
    watcher: FakeWatcher;
    listener: (event: string, filename: string | Buffer | null) => void;
  }> = [];
  const publications: unknown[] = [];
  const warnings: string[] = [];
  const metadataChanges: string[] = [];
  const metrics = new PerformanceMetricsCollector();
  const watcher = new GitRepositoryWatcher(
    {
      publishBestEffort: (_type, data) => {
        if (options.publisherThrows) throw new Error("publish failed");
        publications.push(data);
      },
    },
    {
      clock,
      diagnostics: metrics,
      now: () => clock.nowMs,
      quietMs: 300,
      maxWaitMs: 2_000,
      maxRepositories: options.maxRepositories,
      watch: (path, _watchOptions, listener) => {
        const target = new FakeWatcher();
        watches.push({ path, watcher: target, listener });
        return target as unknown as FSWatcher;
      },
      onWarning: (message) => warnings.push(message),
      onRepositoryMetadataChanged: (repoDir) => metadataChanges.push(repoDir),
    },
  );
  return {
    clock,
    metadataChanges,
    metrics,
    publications,
    warnings,
    watcher,
    watches,
  };
}

describe("GitRepositoryWatcher", () => {
  it("trailing-debounces a repository burst and ignores noisy git internals", () => {
    const { clock, publications, watcher, watches, metrics } = setup();
    watcher.watch("proj_one", ".", "/repo");
    const emit = watches[0]?.listener;
    assert.ok(emit);

    emit("change", ".git/objects/aa/object");
    emit("change", ".git/index.lock");
    clock.advanceTo(1_000);
    assert.equal(publications.length, 0);

    emit("change", "src/a.ts");
    clock.advanceTo(1_200);
    emit("change", "src/b.ts");
    clock.advanceTo(1_499);
    assert.equal(publications.length, 0);
    clock.advanceTo(1_500);
    assert.deepEqual(publications, [
      { projectId: "proj_one", repo: ".", source: "filesystem" },
    ]);
    const snapshot = metrics.snapshotAndReset();
    assert.equal(snapshot.metrics["git.watcherCreated"]?.count, 1);
    assert.equal(snapshot.metrics["git.filesystemEvent"]?.count, 4);
    assert.equal(snapshot.metrics["git.invalidation"]?.count, 1);
  });

  it("flushes continuous writes at the maximum wait and isolates repositories", () => {
    const { clock, publications, watcher, watches } = setup();
    watcher.watch("proj_one", ".", "/one");
    watcher.watch("proj_two", "nested", "/two");
    const first = watches[0]?.listener;
    const second = watches[1]?.listener;
    assert.ok(first && second);

    first("change", "a.ts");
    for (let at = 250; at < 2_000; at += 250) {
      clock.advanceTo(at);
      first("change", "a.ts");
    }
    second("change", "b.ts");
    clock.advanceTo(2_000);
    assert.deepEqual(publications, [
      { projectId: "proj_one", repo: ".", source: "filesystem" },
    ]);
    clock.advanceTo(2_050);
    assert.deepEqual(publications[1], {
      projectId: "proj_two",
      repo: "nested",
      source: "filesystem",
    });
  });

  it("watches external worktree gitdirs and closes evicted resources", async () => {
    const root = await mkdtemp(join(tmpdir(), "nerve-git-watch-"));
    const worktree = join(root, "worktree");
    const gitDir = join(root, "git", "worktrees", "one");
    await Promise.all([mkdir(worktree), mkdir(gitDir, { recursive: true })]);
    await writeFile(join(worktree, ".git"), "gitdir: ../git/worktrees/one\n");

    const { watcher, watches } = setup({ maxRepositories: 1 });
    watcher.watch("proj_one", ".", worktree);
    assert.deepEqual(
      watches.map((entry) => entry.path),
      [worktree, gitDir],
    );
    watcher.watch("proj_two", ".", join(root, "other"));
    assert.equal(watches[0]?.watcher.closed, true);
    assert.equal(watches[1]?.watcher.closed, true);
    watcher.close();
    assert.equal(watches[2]?.watcher.closed, true);
  });

  it("contains publication failures and cancels pending timers on close", () => {
    const { clock, metadataChanges, warnings, watcher, watches } = setup({
      publisherThrows: true,
    });
    watcher.watch("proj_one", ".", "/repo");
    watches[0]?.listener("change", ".git/HEAD");
    clock.advanceTo(300);
    assert.deepEqual(warnings, ["Could not publish Git invalidation"]);
    assert.deepEqual(metadataChanges, ["/repo"]);

    watches[0]?.listener("change", "next.ts");
    watcher.close();
    clock.advanceTo(3_000);
    assert.equal(warnings.length, 1);
    assert.equal(watches[0]?.watcher.closed, true);
  });
});
