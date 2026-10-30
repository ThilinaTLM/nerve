import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { after, describe, it, mock } from "node:test";
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
  await write("data/conversations/a/reports/report.md", 4);
  await write("data/images/image.png", 5);
  await write("data/plans/plan.md", 6);
  await write("data/launches/launch_1/log.txt", 8);
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
    assert.equal(categoryBytes(usage, "payloads"), 22);
    assert.equal(
      usage.categories.some((category) => category.key === "runtimeState"),
      false,
    );
    assert.equal(categoryBytes(usage, "queryCache"), undefined);
    assert.equal(categoryBytes(usage, "cache"), 66);
    assert.equal(categoryBytes(usage, "other"), 63);
    assert.equal(categoryBytes(usage, "tasks"), undefined);
    assert.deepEqual(usage.database, {
      dbBytes: 10,
      walBytes: 2,
      shmBytes: 0,
    });
    assert.deepEqual(usage.conversations, {
      total: 2,
      largest: [
        { conversationId: "conv_a", title: "Alpha", bytes: 15 },
        { conversationId: "conv_b", title: "Beta", bytes: 7 },
      ],
    });

    assert.equal(targetBytes(usage, "cache"), 66);
    assert.equal(targetBytes(usage, "searchIndex"), undefined);
    assert.equal(targetBytes(usage, "conversations"), 22);
    assert.equal(targetBytes(usage, "datedLogs"), 12);
    assert.equal(targetBytes(usage, "rotatedEventLog"), 13);
    assert.equal(categoryBytes(usage, "reports"), undefined);
    assert.equal(targetBytes(usage, "crashReports"), 14);
    assert.equal(targetBytes(usage, "tmp"), 19);
  });

  it("exposes only an existing archived home through storage usage", async () => {
    const home = await fixtureHome();
    const archive = `${home}.archive-test`;
    roots.push(archive);
    const service = new StorageUsageService({
      paths: storagePaths(home),
      getSource: () => ({ listConversations: () => [] }),
    });
    assert.equal((await service.computeUsage(true)).archivedHomeDir, undefined);
    await mkdir(archive);
    await writeFile(
      join(home, "archived-home.json"),
      JSON.stringify({ version: 1, path: archive }),
    );
    assert.equal((await service.computeUsage(true)).archivedHomeDir, archive);
    await rm(archive, { recursive: true });
    assert.equal((await service.computeUsage(true)).archivedHomeDir, undefined);
    await writeFile(join(home, "archived-home.json"), "{broken");
    assert.equal((await service.computeUsage(true)).archivedHomeDir, undefined);
  });

  it("shares concurrent refreshes, caches results, and bypasses cache on force", async () => {
    const home = await fixtureHome();
    let reads = 0;
    const service = new StorageUsageService({
      paths: storagePaths(home),
      getSource: () => ({
        listConversations: () => {
          reads += 1;
          return [];
        },
      }),
    });
    const responses = await Promise.all(
      Array.from({ length: 12 }, () => service.computeUsage(true)),
    );
    assert.equal(reads, 1);
    assert.ok(responses.every((value) => value === responses[0]));
    assert.equal(await service.computeUsage(), responses[0]);
    assert.notEqual(await service.computeUsage(true), responses[0]);
    assert.equal(reads, 2);
    service.invalidate();
    await service.computeUsage();
    assert.equal(reads, 3);
  });

  it(
    "does not cache an invalidated scan or clear a newer in-flight refresh",
    { timeout: 5_000 },
    async () => {
      const home = await fixtureHome();
      const paths = storagePaths(home);
      const service = new StorageUsageService({
        paths,
        getSource: () => ({ listConversations: () => [] }),
      });
      const original = fs.readdir;
      const gates = [
        Promise.withResolvers<void>(),
        Promise.withResolvers<void>(),
      ];
      const entered = [
        Promise.withResolvers<void>(),
        Promise.withResolvers<void>(),
      ];
      let scans = 0;
      const reader = mock.method(
        fs,
        "readdir",
        async (...args: Parameters<typeof original>) => {
          // Pause each scan at its last traversal, after payload totals are known.
          if (args[0] === home && scans < gates.length) {
            const index = scans++;
            entered[index].resolve();
            await gates[index].promise;
          }
          return original(...args);
        },
      );
      syncBuiltinESMExports();
      try {
        const stale = service.computeUsage();
        await entered[0].promise;
        service.invalidate();
        await writeFile(join(paths.conversationsPath, "a", "new"), "extra");
        const fresh = service.computeUsage();
        await entered[1].promise;
        gates[0].resolve();
        const staleValue = await stale;
        const joined = service.computeUsage();
        gates[1].resolve();
        const freshValue = await fresh;
        assert.equal(await joined, freshValue);
        assert.equal(await service.computeUsage(), freshValue);
        assert.equal(categoryBytes(freshValue, "payloads"), 27);
        assert.equal(categoryBytes(staleValue, "payloads"), 22);
        assert.equal(scans, 2);
      } finally {
        gates.forEach((gate) => gate.resolve());
        reader.mock.restore();
        syncBuiltinESMExports();
      }
    },
  );

  it("expires cached usage after fifteen seconds", async () => {
    const home = await fixtureHome();
    const service = new StorageUsageService({
      paths: storagePaths(home),
      getSource: () => ({ listConversations: () => [] }),
    });
    let now = Date.now();
    const clock = mock.method(Date, "now", () => now);
    try {
      const initial = await service.computeUsage();
      now += 14_999;
      assert.equal(await service.computeUsage(), initial);
      now += 1;
      assert.notEqual(await service.computeUsage(), initial);
    } finally {
      clock.mock.restore();
    }
  });

  it("retries after a rejected refresh instead of retaining a rejected promise", async () => {
    const home = await fixtureHome();
    let fail = true;
    const service = new StorageUsageService({
      paths: storagePaths(home),
      getSource: () => {
        if (fail) throw new Error("source unavailable");
        return { listConversations: () => [] };
      },
    });
    await assert.rejects(service.computeUsage(), /source unavailable/);
    fail = false;
    assert.equal((await service.computeUsage()).totalBytes, 402);
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
