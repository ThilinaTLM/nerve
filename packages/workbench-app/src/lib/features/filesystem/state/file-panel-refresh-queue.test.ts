import assert from "node:assert/strict";
import { test } from "node:test";
import { createFilePanelRefreshQueue } from "./file-panel-refresh-queue";

test("manual refresh reloads the full panel without a monitor generation", async () => {
  const refreshes: Array<readonly string[] | undefined> = [];
  const queue = createFilePanelRefreshQueue((directories) => {
    refreshes.push(directories);
  });

  await queue.requestFullRefresh();

  assert.deepEqual(refreshes, [undefined]);
  queue.stop();
});

test("monitor refresh ignores stale and duplicate generations", async () => {
  const refreshes: Array<readonly string[] | undefined> = [];
  const queue = createFilePanelRefreshQueue((directories) => {
    refreshes.push(directories);
  });

  await queue.accept({
    generation: 2,
    directories: ["src"],
    fullRefreshRequired: false,
  });
  await queue.accept({
    generation: 2,
    directories: ["docs"],
    fullRefreshRequired: false,
  });
  await queue.accept({
    generation: 1,
    directories: ["tests"],
    fullRefreshRequired: false,
  });

  assert.deepEqual(refreshes, [["src"]]);
  queue.stop();
});

test("manual refresh queues a full reload behind an in-flight monitor refresh", async () => {
  const refreshes: Array<readonly string[] | undefined> = [];
  let releaseFirst: (() => void) | undefined;
  const firstRefresh = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  const queue = createFilePanelRefreshQueue(async (directories) => {
    refreshes.push(directories);
    if (refreshes.length === 1) await firstRefresh;
  });

  const monitor = queue.accept({
    generation: 1,
    directories: ["src"],
    fullRefreshRequired: false,
  });
  const manual = queue.requestFullRefresh();
  const newerMonitor = queue.accept({
    generation: 2,
    directories: ["docs"],
    fullRefreshRequired: false,
  });

  assert.deepEqual(refreshes, [["src"]]);
  releaseFirst?.();
  await Promise.all([monitor, manual, newerMonitor]);

  assert.deepEqual(refreshes, [["src"], undefined]);
  queue.stop();
});
