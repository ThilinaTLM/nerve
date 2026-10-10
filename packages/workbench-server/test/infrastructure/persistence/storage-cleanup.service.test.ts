import assert from "node:assert/strict";
import {
  access,
  mkdir,
  mkdtemp,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { StorageCleanupExecutor } from "../../../src/domains/storage/storage-cleanup.service.js";
import { StorageUsageService } from "../../../src/domains/storage/storage-usage.service.js";
import { storagePaths } from "../../../src/infrastructure/storage-bootstrap/index.js";
import type {
  MaintenanceExecution,
  MaintenanceProgressPatch,
} from "../../../src/domains/maintenance/maintenance-execution.js";

async function fixture(t: import("node:test").TestContext) {
  const home = await mkdtemp(join(tmpdir(), "nerve-cleanup-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const paths = storagePaths(home);
  const updates: MaintenanceProgressPatch[] = [];
  let cancelled = false;
  const execution: MaintenanceExecution = {
    operationId: "maintenanceop_test",
    cancelled: () => cancelled,
    report: async (patch) => {
      updates.push(patch);
    },
  };
  const usage = new StorageUsageService({
    paths,
    getSource: () => ({ listConversations: () => [] }),
  });
  const pruneRequests: number[] = [];
  const executor = new StorageCleanupExecutor({
    paths,
    usage,
    getOperations: () => ({
      pruneConversationsAcrossProjects: async (request) => {
        pruneRequests.push(request.olderThanDays);
        return { removedConversationCount: 2, skippedCount: 1 };
      },
    }),
  });
  return {
    home,
    paths,
    usage,
    updates,
    execution,
    executor,
    pruneRequests,
    cancel: () => {
      cancelled = true;
    },
  };
}

test("clears disposable files, keeps external symlink targets, and invalidates usage", async (t) => {
  const f = await fixture(t);
  await mkdir(f.paths.cachePath, { recursive: true });
  await mkdir(f.paths.tmpPath, { recursive: true });
  const external = join(f.home, "external");
  await writeFile(external, "keep");
  await writeFile(join(f.paths.cachePath, "models.json"), "cache");
  await symlink(external, join(f.paths.cachePath, "link"));
  await writeFile(join(f.paths.tmpPath, "scratch"), "temp");
  const before = await f.usage.computeUsage();
  await f.executor.execute({ clearCache: true, clearTmp: true }, f.execution);
  await access(external);
  await access(f.paths.cachePath);
  await assert.rejects(access(join(f.paths.cachePath, "models.json")));
  await assert.rejects(access(join(f.paths.tmpPath, "scratch")));
  const last = f.updates.at(-1)!;
  assert.equal(last.result?.kind, "storage_cleanup");
  if (last.result?.kind === "storage_cleanup") {
    assert.deepEqual(
      last.result.targets.map((target) => [
        target.target,
        target.removedItems,
        target.skipped,
      ]),
      [
        ["cache", 1, 1],
        ["tmp", 1, 0],
      ],
    );
  }
  assert.ok((await f.usage.computeUsage()).totalBytes < before.totalBytes);
});

test("prunes only old dated logs and the explicitly selected rotated event log", async (t) => {
  const f = await fixture(t);
  await mkdir(f.paths.logsPath, { recursive: true });
  for (const name of [
    "application-2000-01-01.jsonl",
    "desktop-2999-01-01.jsonl",
    "events.jsonl",
    "events.jsonl.1",
  ])
    await writeFile(join(f.paths.logsPath, name), "log");
  await f.executor.execute(
    { logsOlderThanDays: 7, truncateEventLog: true },
    f.execution,
  );
  await assert.rejects(
    access(join(f.paths.logsPath, "application-2000-01-01.jsonl")),
  );
  await assert.rejects(access(join(f.paths.logsPath, "events.jsonl.1")));
  await access(join(f.paths.logsPath, "events.jsonl"));
  await access(join(f.paths.logsPath, "desktop-2999-01-01.jsonl"));
});

test("delegates conversation pruning and reports skipped active conversations", async (t) => {
  const f = await fixture(t);
  await f.executor.execute({ conversationsOlderThanDays: 30 }, f.execution);
  assert.deepEqual(f.pruneRequests, [30]);
  const result = f.updates.at(-1)?.result;
  assert.equal(result?.kind, "storage_cleanup");
  if (result?.kind === "storage_cleanup") {
    assert.equal(result.targets[0]?.removedItems, 2);
    assert.equal(result.targets[0]?.skipped, 1);
  }
});

test("cancellation leaves targets untouched and reports cancelled outcomes", async (t) => {
  const f = await fixture(t);
  await mkdir(f.paths.cachePath, { recursive: true });
  await writeFile(join(f.paths.cachePath, "keep"), "cache");
  f.cancel();
  await f.executor.execute({ clearCache: true }, f.execution);
  await access(join(f.paths.cachePath, "keep"));
  const result = f.updates.at(-1)?.result;
  assert.equal(result?.kind, "storage_cleanup");
  if (result?.kind === "storage_cleanup")
    assert.equal(result.targets[0]?.outcome, "cancelled");
});
