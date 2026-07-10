import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { StorageUsageService } from "../src/domains/storage/index.js";
import { storagePaths } from "../src/infrastructure/storage/index.js";

const roots: string[] = [];
after(async () =>
  Promise.all(roots.map((root) => rm(root, { recursive: true, force: true }))),
);

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
  await write("logs/events.jsonl.1", 1_200);
  await write("logs/tool-calls.jsonl", 400);
  await write("logs/application-2020-01-01.jsonl", 300);
  await write("cache/usage/snapshot.json", 250);
  await write("tmp/scratch.txt", 60);
  await write("explore-reports/report-1.md", 70);
  await write("maintenance/storage-cleanup.json", 20);
  await write("auth/local-token", 40);
  await write("keys/credential-key", 40);
  await write("config.json", 20);
  return home;
}

function makeService(home: string) {
  return new StorageUsageService({
    paths: storagePaths(home),
    getRegistry: () => ({
      listConversations: () => [
        { id: "conv_big", title: "Big chat" },
        { id: "conv_small", title: null },
      ],
    }),
  });
}

describe("StorageUsageService", () => {
  it("computes categories, largest conversations, and target footprints", async () => {
    const home = await seedDataDir();
    const usage = await makeService(home).computeUsage(true);
    const byKey = new Map(
      usage.categories.map((category) => [category.key, category]),
    );
    const byTarget = new Map(
      usage.cleanupTargets.map((target) => [target.target, target]),
    );

    assert.equal(byKey.get("conversations")?.bytes, 5_100);
    assert.equal(byKey.get("cache")?.bytes, 250);
    assert.equal(byKey.get("tmp")?.bytes, 60);
    assert.equal(byKey.get("exploreReports")?.bytes, 70);
    assert.equal(byKey.get("workflowState")?.bytes, 20);
    assert.equal(byKey.get("protected")?.bytes, 100);
    assert.equal(byKey.get("protected")?.protected, true);
    assert.equal(
      usage.totalBytes,
      usage.categories.reduce((sum, category) => sum + category.bytes, 0),
    );
    assert.equal(usage.conversations.total, 2);
    assert.equal(usage.conversations.largest[0]?.conversationId, "conv_big");
    assert.equal(usage.conversations.largest[0]?.title, "Big chat");
    assert.deepEqual(byTarget.get("rotatedEventLog"), {
      target: "rotatedEventLog",
      bytes: 1_200,
      itemCount: 1,
      estimate: "exact",
    });
    assert.equal(byTarget.get("toolCallLog")?.bytes, 400);
    assert.equal(byTarget.get("datedLogs")?.bytes, 300);
  });

  it("invalidates a cached snapshot", async () => {
    const home = await seedDataDir();
    const service = makeService(home);
    const first = await service.computeUsage(true);
    await writeFile(join(home, "tmp", "new.txt"), "x".repeat(50));
    assert.equal((await service.computeUsage()).generatedAt, first.generatedAt);
    service.invalidate();
    const refreshed = await service.computeUsage();
    assert.ok(refreshed.totalBytes > first.totalBytes);
  });
});
