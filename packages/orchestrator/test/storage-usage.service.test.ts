import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import {
  type StorageRegistryPort,
  StorageUsageService,
} from "../src/domains/storage/index.js";
import { IndexStore } from "../src/infrastructure/index-store/index.js";
import { storagePaths } from "../src/infrastructure/storage/index.js";

const roots: string[] = [];

after(async () => {
  await Promise.all(
    roots.map((root) => rm(root, { recursive: true, force: true })),
  );
});

const today = new Date().toISOString().slice(0, 10);

async function seedDataDir(): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), "nerve-storage-"));
  roots.push(home);
  const write = async (relative: string, bytes: number) => {
    const path = join(home, relative);
    await mkdir(join(path, ".."), { recursive: true });
    await writeFile(path, "x".repeat(bytes));
  };
  await write("conversations/conv_big/events.jsonl", 5_000);
  await write("conversations/conv_small/events.jsonl", 100);
  await write("logs/events.jsonl", 800);
  await write("logs/events.jsonl.1", 1_200);
  await write("logs/tool-calls.jsonl", 400);
  await write("logs/application-2020-01-01.jsonl", 300);
  await write(`logs/application-${today}.jsonl`, 150);
  await write(`logs/desktop-2020-01-01.jsonl`, 90);
  await write("cache/usage/snapshot.json", 250);
  await write("tmp/scratch.txt", 60);
  await write("explore-reports/report-1.md", 70);
  // Protected — must never be touched.
  await write("auth/local-token", 40);
  await write("keys/credential-key", 40);
  await write("config.json", 20);
  return home;
}

function fakeRegistry(home: string): StorageRegistryPort {
  return {
    async pruneConversationsAcrossProjects() {
      // Simulate pruning the small conversation, skipping nothing.
      await rm(join(home, "conversations", "conv_small"), {
        recursive: true,
        force: true,
      });
      return { prunedConversationIds: ["conv_small"], skippedCount: 0 };
    },
    listConversations() {
      return [
        { id: "conv_big", title: "Big chat" },
        { id: "conv_small", title: null },
      ];
    },
    tools: {
      async compactToolCallLog() {
        await writeFile(join(home, "logs", "tool-calls.jsonl"), "x".repeat(50));
      },
      toolCallLogPath() {
        return join(home, "logs", "tool-calls.jsonl");
      },
    },
  };
}

function makeService(home: string, port: StorageRegistryPort) {
  const paths = storagePaths(home);
  const index = new IndexStore(paths.sqlitePath);
  index.initialize();
  return {
    service: new StorageUsageService({
      paths,
      index,
      getRegistry: () => port,
    }),
    index,
    paths,
  };
}

describe("StorageUsageService", () => {
  it("computes a category breakdown, totals, and largest conversations", async () => {
    const home = await seedDataDir();
    const port = fakeRegistry(home);
    const { service } = makeService(home, port);

    const usage = await service.computeUsage(true);

    const byKey = new Map(usage.categories.map((c) => [c.key, c]));
    assert.equal(byKey.get("conversations")?.bytes, 5_100);
    assert.ok((byKey.get("logs")?.bytes ?? 0) >= 800 + 1_200 + 400);
    assert.equal(byKey.get("cache")?.bytes, 250);
    assert.equal(byKey.get("tmp")?.bytes, 60);
    assert.equal(byKey.get("exploreReports")?.bytes, 70);

    const protectedCategory = byKey.get("protected");
    assert.equal(protectedCategory?.protected, true);
    assert.equal(protectedCategory?.cleanable, false);
    assert.equal(protectedCategory?.bytes, 100); // 40 + 40 + 20

    assert.equal(
      usage.totalBytes,
      usage.categories.reduce((sum, c) => sum + c.bytes, 0),
    );
    assert.equal(usage.conversations.total, 2);
    assert.equal(usage.conversations.largest[0]?.conversationId, "conv_big");
    assert.equal(usage.conversations.largest[0]?.title, "Big chat");
  });

  it("clears caches and tmp without touching protected files", async () => {
    const home = await seedDataDir();
    const port = fakeRegistry(home);
    const { service } = makeService(home, port);

    const result = await service.cleanup({ clearCache: true, clearTmp: true });

    assert.ok(result.freedBytes >= 250 + 60);
    assert.deepEqual(await readdir(join(home, "cache")), []);
    assert.deepEqual(await readdir(join(home, "tmp")), []);
    // Protected files remain.
    assert.deepEqual(await readdir(join(home, "auth")), ["local-token"]);
    assert.deepEqual(await readdir(join(home, "keys")), ["credential-key"]);
    assert.ok(
      result.usage.totalBytes <
        (await service.computeUsage(true)).totalBytes + 1,
    );
  });

  it("prunes dated logs older than the cutoff but keeps recent ones", async () => {
    const home = await seedDataDir();
    const port = fakeRegistry(home);
    const { service } = makeService(home, port);

    await service.cleanup({ logsOlderThanDays: 7 });

    const logs = await readdir(join(home, "logs"));
    assert.ok(!logs.includes("application-2020-01-01.jsonl"));
    assert.ok(!logs.includes("desktop-2020-01-01.jsonl"));
    assert.ok(logs.includes(`application-${today}.jsonl`));
    assert.ok(logs.includes("events.jsonl"));
  });

  it("removes the rotated event log only", async () => {
    const home = await seedDataDir();
    const port = fakeRegistry(home);
    const { service } = makeService(home, port);

    const result = await service.cleanup({ truncateEventLog: true });

    const logs = await readdir(join(home, "logs"));
    assert.ok(!logs.includes("events.jsonl.1"));
    assert.ok(logs.includes("events.jsonl"));
    assert.equal(result.results[0]?.freedBytes, 1_200);
  });

  it("delegates conversation cleanup to the cross-project prune", async () => {
    const home = await seedDataDir();
    const port = fakeRegistry(home);
    const { service } = makeService(home, port);

    const result = await service.cleanup({ conversationsOlderThanDays: 30 });

    const conversationsResult = result.results.find(
      (r) => r.target === "conversations",
    );
    assert.equal(conversationsResult?.removedItems, 1);
    assert.ok(
      conversationsResult?.freedBytes && conversationsResult.freedBytes > 0,
    );
    assert.ok(
      !(await readdir(join(home, "conversations"))).includes("conv_small"),
    );
  });

  it("vacuums the sqlite index", async () => {
    const home = await seedDataDir();
    const port = fakeRegistry(home);
    const { service } = makeService(home, port);

    const result = await service.cleanup({ vacuumSqlite: true });
    const vacuumResult = result.results.find(
      (r) => r.target === "sqliteVacuum",
    );
    assert.equal(vacuumResult?.skipped, 0);
  });
});
