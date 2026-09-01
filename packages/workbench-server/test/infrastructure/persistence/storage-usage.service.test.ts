import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { after, describe, it } from "node:test";
import { StorageUsageService } from "../../../src/domains/storage/storage-usage.service.js";
import { storagePaths } from "../../../src/infrastructure/storage-bootstrap/index.js";

const roots: string[] = [];
after(async () =>
  Promise.all(roots.map((root) => rm(root, { recursive: true, force: true }))),
);

async function fixtureHome(): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), "nerve-usage-"));
  roots.push(home);
  const write = async (relative: string, bytes: number) => {
    const path = join(home, relative);
    await mkdir(join(path, ".."), { recursive: true });
    await writeFile(path, "x".repeat(bytes));
  };

  await write("data/nerve.sqlite", 10);
  await write("data/nerve.sqlite-wal", 2);
  await write("data/conversations/a/result.json", 11);
  await write("data/conversations/b/result.json", 7);
  await write("data/reports/report.md", 4);
  await write("data/images/image.png", 5);
  await write("data/plans/plan.md", 6);
  await write("data/tasks/task_1/log.txt", 8);
  await write("agent/suggestions/items.json", 9);
  await write("logs/application-2020-01-01.jsonl", 12);
  await write("logs/events.jsonl.1", 13);
  await write("crashes/report.json", 14);
  await write("cache/query-cache.sqlite", 15);
  await write("cache/query-cache.sqlite-wal", 16);
  await write("cache/query-cache.sqlite.cleanup-backup", 17);
  await write("cache/models.json", 18);
  await write("tmp/scratch", 19);
  await write("migrations/ledger.json", 20);
  await write("backups/legacy/file", 21);
  await write("config/daemon.json", 22);
  await write("secrets/master.key", 23);
  await write("tls/ca.pem", 24);
  await write("manifest.json", 25);
  await write("daemon.json", 26);
  await write("unknown-root.bin", 27);
  await write("data/unknown-data.bin", 28);

  const external = join(home, "..", `${basename(home)}-external`);
  await writeFile(external, "x".repeat(100));
  roots.push(external);
  await symlink(external, join(home, "unknown-link"));
  await symlink(external, join(home, "cache", "cache-link"));
  return home;
}

function categoryBytes(
  usage: Awaited<ReturnType<StorageUsageService["computeUsage"]>>,
  key: string,
): number | undefined {
  return usage.categories.find((category) => category.key === key)?.bytes;
}

function targetBytes(
  usage: Awaited<ReturnType<StorageUsageService["computeUsage"]>>,
  target: string,
): number | undefined {
  return usage.cleanupTargets.find((item) => item.target === target)?.bytes;
}

describe("StorageUsageService", () => {
  it("classifies readable v1 home files exactly once", async () => {
    const home = await fixtureHome();
    const service = new StorageUsageService({
      paths: storagePaths(home),
      getSource: () => ({
        listConversations: () => [
          { id: "conv_a", title: "Alpha" },
          { id: "conv_b", title: "Beta" },
        ],
      }),
    });

    const usage = await service.computeUsage(true);
    assert.equal(usage.homeDir, home);
    assert.equal(usage.totalBytes, 402);
    assert.equal(
      usage.categories.reduce((sum, category) => sum + category.bytes, 0),
      usage.totalBytes,
    );
    assert.equal(categoryBytes(usage, "database"), 12);
    assert.equal(
      usage.categories.find((category) => category.key === "database")
        ?.fileCount,
      2,
    );
    assert.equal(categoryBytes(usage, "payloads"), 18);
    assert.equal(
      usage.categories.some((category) => category.key === "runtimeState"),
      false,
    );
    assert.equal(categoryBytes(usage, "queryCache"), 48);
    assert.equal(categoryBytes(usage, "cache"), 18);
    assert.equal(categoryBytes(usage, "other"), 55);
    assert.deepEqual(usage.database, {
      dbBytes: 10,
      walBytes: 2,
      shmBytes: 0,
    });
    assert.deepEqual(usage.conversations, {
      total: 2,
      largest: [
        { conversationId: "conv_a", title: "Alpha", bytes: 11 },
        { conversationId: "conv_b", title: "Beta", bytes: 7 },
      ],
    });

    assert.equal(targetBytes(usage, "cache"), 18);
    assert.equal(targetBytes(usage, "searchIndex"), 48);
    assert.equal(targetBytes(usage, "conversations"), 18);
    assert.equal(targetBytes(usage, "datedLogs"), 12);
    assert.equal(targetBytes(usage, "rotatedEventLog"), 13);
    assert.equal(targetBytes(usage, "exploreReports"), 4);
    assert.equal(targetBytes(usage, "crashReports"), 14);
    assert.equal(targetBytes(usage, "tmp"), 19);
  });

  it("returns a stable empty response for an empty home", async () => {
    const home = await mkdtemp(join(tmpdir(), "nerve-usage-empty-"));
    roots.push(home);
    const usage = await new StorageUsageService({
      paths: storagePaths(home),
      getSource: () => ({ listConversations: () => [] }),
    }).computeUsage(true);

    assert.equal(usage.totalBytes, 0);
    assert.deepEqual(usage.categories, []);
    assert.deepEqual(usage.database, {
      dbBytes: 0,
      walBytes: 0,
      shmBytes: 0,
    });
  });
});
