import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import {
  StorageCleanupRepository,
  StorageCleanupService,
  StorageUsageService,
} from "../../../src/domains/storage/index.js";
import { ApplicationLogger } from "../../../src/infrastructure/diagnostics/index.js";
import { CanonicalStore } from "../../../src/infrastructure/persistence/canonical-sqlite/index.js";
import { StreamLogRegistry } from "../../../src/infrastructure/events/index.js";
import { storagePaths } from "../../../src/infrastructure/storage-bootstrap/index.js";

const roots: string[] = [];
after(async () =>
  Promise.all(roots.map((root) => rm(root, { recursive: true, force: true }))),
);

async function seedHome(): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), "nerve-cleanup-"));
  roots.push(home);
  const write = async (relative: string, bytes: number) => {
    const path = join(home, relative);
    await mkdir(join(path, ".."), { recursive: true });
    await writeFile(path, "x".repeat(bytes));
  };
  await write("logs/events.jsonl.1", 1_200);
  await write("logs/tool-calls.jsonl", 400);
  await write("logs/application-2020-01-01.jsonl", 300);
  await write("crashes/report.json", 500);
  await write("cache/value.json", 250);
  await write("cache/query-cache.sqlite", 600);
  await write("cache/query-cache.sqlite.cleanup-backup", 80);
  await write("tmp/scratch.txt", 60);
  await write("secrets/daemon-token", 40);
  return home;
}

async function makeService(
  home: string,
  overrides: {
    prune?: () => Promise<{
      prunedConversationIds: string[];
      skippedCount: number;
    }>;
    rebuild?: () => Promise<void>;
  } = {},
) {
  const paths = storagePaths(home);
  const registry = {
    listConversations: () => [],
    pruneConversationsAcrossProjects:
      overrides.prune ??
      (async () => ({ prunedConversationIds: [], skippedCount: 0 })),
    rebuildSearchIndex: overrides.rebuild ?? (async () => {}),
    tools: {
      async compactToolCallLog() {
        await writeFile(join(home, "logs", "tool-calls.jsonl"), "x".repeat(20));
      },
      toolCallLogPath() {
        return join(home, "logs", "tool-calls.jsonl");
      },
    },
  };
  const usage = new StorageUsageService({ paths, getSource: () => registry });
  const events = new StreamLogRegistry(home);
  const logger = new ApplicationLogger({
    dataDir: home,
    source: "orchestrator",
    component: "storage-test",
  });
  const canonicalStore = new CanonicalStore(paths.sqlitePath);
  await canonicalStore.initialize();
  const repository = new StorageCleanupRepository(canonicalStore);
  const service = new StorageCleanupService({
    paths,
    repository,
    usage,
    events,
    logger,
    getOperations: () => registry,
  });
  return { service, repository, usage };
}

async function waitForTerminal(
  service: StorageCleanupService,
  timeoutMs = 2_000,
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const operation = service.get();
    if (
      operation &&
      ["succeeded", "failed", "cancelled"].includes(operation.status)
    )
      return operation;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("cleanup did not finish");
}

describe("StorageCleanupService", () => {
  it("accepts immediately, clears selected data, and persists detailed results", async () => {
    const home = await seedHome();
    const { service, repository, usage } = await makeService(home);
    await service.hydrate();
    const before = await usage.computeUsage(true);
    assert.equal(
      before.categories.find((category) => category.key === "crashReports")
        ?.bytes,
      500,
    );
    assert.equal(
      before.cleanupTargets.find((target) => target.target === "crashReports")
        ?.bytes,
      500,
    );

    const queued = await service.start({
      logsOlderThanDays: 7,
      truncateEventLog: true,
      clearCrashReports: true,
      clearCache: true,
      clearTmp: true,
    });
    assert.equal(queued.status, "queued");
    assert.equal(queued.totalTargets, 5);

    const result = await waitForTerminal(service);
    assert.equal(result.status, "succeeded", result.error);
    assert.equal(result.results.length, 5);
    assert.ok(result.freedBytes >= 300 + 1_200 + 500 + 250 + 60);
    await assert.rejects(readdir(join(home, "crashes")), /ENOENT/);
    assert.deepEqual(await readdir(join(home, "cache")), [
      "query-cache.sqlite",
      "query-cache.sqlite.cleanup-backup",
    ]);
    await assert.rejects(readdir(join(home, "tmp")), /ENOENT/);
    assert.deepEqual(await readdir(join(home, "secrets")), ["daemon-token"]);
    assert.equal((await repository.read())?.id, result.id);
  });

  it("keeps generic cache and query-cache rebuild disjoint", async () => {
    const home = await seedHome();
    const { service, usage } = await makeService(home, {
      rebuild: async () => {
        await writeFile(
          join(home, "cache", "query-cache.sqlite"),
          "x".repeat(100),
        );
        await rm(join(home, "cache", "query-cache.sqlite.cleanup-backup"), {
          force: true,
        });
      },
    });
    await service.hydrate();

    const before = await usage.computeUsage(true);
    assert.equal(
      before.cleanupTargets.find((target) => target.target === "cache")?.bytes,
      250,
    );
    assert.equal(
      before.cleanupTargets.find((target) => target.target === "searchIndex")
        ?.bytes,
      680,
    );

    await service.start({ clearCache: true, rebuildSearchIndex: true });
    const result = await waitForTerminal(service);
    assert.equal(result.status, "succeeded", result.error);
    assert.equal(
      result.results.find((item) => item.target === "cache")?.freedBytes,
      250,
    );
    assert.equal(
      result.results.find((item) => item.target === "searchIndex")?.freedBytes,
      580,
    );
    assert.deepEqual(await readdir(join(home, "cache")), [
      "query-cache.sqlite",
    ]);
  });

  it("cancels at a target boundary and leaves later targets untouched", async () => {
    const home = await seedHome();
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { service } = await makeService(home, {
      prune: async () => {
        await blocked;
        return { prunedConversationIds: [], skippedCount: 0 };
      },
    });
    await service.hydrate();
    const queued = await service.start({
      conversationsOlderThanDays: 30,
      clearCache: true,
    });
    while (service.get()?.currentTarget !== "conversations")
      await new Promise((resolve) => setTimeout(resolve, 5));
    const cancelling = await service.cancel(queued.id);
    assert.equal(cancelling.status, "cancelling");
    release();

    const result = await waitForTerminal(service);
    assert.equal(result.status, "cancelled");
    assert.equal(
      result.results.find((item) => item.target === "cache")?.outcome,
      "cancelled",
    );
    assert.deepEqual(await readdir(join(home, "cache")), [
      "query-cache.sqlite",
      "query-cache.sqlite.cleanup-backup",
      "value.json",
    ]);
  });

  it("marks an active persisted operation interrupted during hydrate", async () => {
    const home = await seedHome();
    const { service, repository } = await makeService(home);
    const now = new Date().toISOString();
    await repository.write({
      id: "storageop_TEST",
      request: { clearCache: true },
      status: "running",
      createdAt: now,
      updatedAt: now,
      startedAt: now,
      message: "Clearing cache…",
      completedTargets: 0,
      totalTargets: 1,
      cancellable: true,
      cancellationRequested: false,
      freedBytes: 0,
      results: [],
    });
    await service.hydrate();
    assert.equal(service.get()?.status, "failed");
    assert.match(service.get()?.error ?? "", /daemon stopped/i);
  });
});
