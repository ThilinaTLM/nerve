import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import {
  StorageCleanupRepository,
  StorageCleanupService,
  StorageUsageService,
} from "../src/domains/storage/index.js";
import { ApplicationLogger } from "../src/infrastructure/diagnostics/index.js";
import { EventBus } from "../src/infrastructure/events/index.js";
import { storagePaths } from "../src/infrastructure/storage/index.js";

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
  await write("cache/value.json", 250);
  await write("tmp/scratch.txt", 60);
  await write("auth/local-token", 40);
  return home;
}

function makeService(
  home: string,
  overrides: {
    prune?: () => Promise<{
      prunedConversationIds: string[];
      skippedCount: number;
    }>;
  } = {},
) {
  const paths = storagePaths(home);
  const registry = {
    listConversations: () => [],
    pruneConversationsAcrossProjects:
      overrides.prune ??
      (async () => ({ prunedConversationIds: [], skippedCount: 0 })),
    async rebuildSearchIndex() {},
    tools: {
      async compactToolCallLog() {
        await writeFile(join(home, "logs", "tool-calls.jsonl"), "x".repeat(20));
      },
      toolCallLogPath() {
        return join(home, "logs", "tool-calls.jsonl");
      },
    },
  };
  const usage = new StorageUsageService({ paths, getRegistry: () => registry });
  const events = new EventBus(home);
  const logger = new ApplicationLogger({
    dataDir: home,
    source: "orchestrator",
    component: "storage-test",
  });
  const repository = new StorageCleanupRepository(
    join(home, "maintenance", "storage-cleanup.json"),
  );
  const service = new StorageCleanupService({
    paths,
    repository,
    usage,
    events,
    logger,
    getRegistry: () => registry,
  });
  return { service, repository };
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
    const { service, repository } = makeService(home);
    await service.hydrate();

    const queued = await service.start({
      logsOlderThanDays: 7,
      truncateEventLog: true,
      clearToolCallLog: true,
      clearCache: true,
      clearTmp: true,
    });
    assert.equal(queued.status, "queued");
    assert.equal(queued.totalTargets, 5);

    const result = await waitForTerminal(service);
    assert.equal(result.status, "succeeded");
    assert.equal(result.results.length, 5);
    assert.ok(result.freedBytes >= 300 + 1_200 + 380 + 250 + 60);
    assert.deepEqual(await readdir(join(home, "cache")), []);
    assert.deepEqual(await readdir(join(home, "tmp")), []);
    assert.deepEqual(await readdir(join(home, "auth")), ["local-token"]);
    assert.equal((await repository.read())?.id, result.id);
  });

  it("cancels at a target boundary and leaves later targets untouched", async () => {
    const home = await seedHome();
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { service } = makeService(home, {
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
    assert.deepEqual(await readdir(join(home, "cache")), ["value.json"]);
  });

  it("marks an active persisted operation interrupted during hydrate", async () => {
    const home = await seedHome();
    const { service, repository } = makeService(home);
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
