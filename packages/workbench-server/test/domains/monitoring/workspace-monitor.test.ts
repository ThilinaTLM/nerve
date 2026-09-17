import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { MonitorDiagnostics, MonitorScopeState } from "@nervekit/native";
import {
  WorkspaceMonitor,
  type NativeChangeMonitorPort,
} from "../../../src/domains/monitoring/workspace-monitor.js";

class FakeMonitor implements NativeChangeMonitorPort {
  directoryScopes: Array<{ id: string; paths: string[] }> = [];
  gitScopes: Array<{ id: string; repository: string }> = [];
  removed: string[] = [];
  generation = 0;

  async syncDirectories(input: { id: string; paths: string[] }) {
    this.directoryScopes.push(input);
    return state(input.paths.length);
  }

  async syncGit(input: { id: string; repository: string }) {
    this.gitScopes.push(input);
    return state(2);
  }

  async requestRefresh(): Promise<number> {
    return ++this.generation;
  }

  async remove(scopeId: string): Promise<void> {
    this.removed.push(scopeId);
  }

  diagnostics(): MonitorDiagnostics {
    return {
      activeScopes: 0,
      registrations: 0,
      degradedScopes: 0,
      emittedNotices: 0,
      coalescedTriggers: 0,
      overflows: 0,
      pollCount: 0,
      pollFailures: 0,
    };
  }

  async close(): Promise<void> {}
}

function state(watchedPaths: number): MonitorScopeState {
  return { generation: 0, watchedPaths, degraded: false };
}

test("unions project demand and removes the scope after the final owner", async () => {
  const root = await mkdtemp(join(tmpdir(), "nerve-workspace-monitor-"));
  await Promise.all([mkdir(join(root, "src")), mkdir(join(root, "docs"))]);
  const native = new FakeMonitor();
  const monitor = new WorkspaceMonitor(
    { publishBestEffort() {} },
    { monitor: native },
  );
  try {
    await monitor.syncProject("one", "proj_one", root, ["src"]);
    await monitor.syncProject("two", "proj_one", root, ["docs"]);
    assert.deepEqual(
      native.directoryScopes.at(-1)?.paths.sort(),
      [root, join(root, "docs"), join(root, "src")].sort(),
    );

    await monitor.releaseOwner("one");
    assert.deepEqual(
      native.directoryScopes.at(-1)?.paths.sort(),
      [root, join(root, "docs")].sort(),
    );
    await monitor.releaseOwner("two");
    assert.deepEqual(native.removed, ["project:proj_one"]);
  } finally {
    await monitor.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("reference-counts repository demand and sequences manual refresh", async () => {
  const root = await mkdtemp(join(tmpdir(), "nerve-repository-monitor-"));
  const native = new FakeMonitor();
  const monitor = new WorkspaceMonitor(
    { publishBestEffort() {} },
    { monitor: native },
  );
  try {
    await monitor.syncRepository("one", "proj_one", ".", root, true);
    await monitor.syncRepository("two", "proj_one", ".", root, true);
    assert.equal(native.gitScopes.at(-1)?.repository, root);
    assert.equal(await monitor.requestRepositoryRefresh("proj_one", "."), 1);
    await monitor.releaseOwner("one");
    assert.equal(native.removed.length, 0);
    await monitor.releaseOwner("two");
    assert.deepEqual(native.removed, ['git:["proj_one","."]']);
  } finally {
    await monitor.close();
    await rm(root, { recursive: true, force: true });
  }
});
