import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { AutoCompactionSettings } from "@nervekit/contracts/settings";
import { ConversationHarnessSettings } from "./conversation-harness.service.js";

const settings = (
  customTriggerPercent: number,
  auto = true,
): AutoCompactionSettings => ({
  auto,
  profile: "custom",
  customTriggerPercent,
});

async function setup(user = settings(80), project = user) {
  const dataPath = await mkdtemp(join(tmpdir(), "nerve-harness-"));
  const changes: string[] = [];
  const service = new ConversationHarnessSettings({
    dataPath,
    userCompaction: () => user,
    projectCompaction: async () => project,
    projectOf: () => "p",
    changed: (_p, c) => changes.push(c),
  });
  const file = join(dataPath, "conversations", "c", "config", "harness.json");
  return {
    service,
    file,
    changes,
    cleanup: () => rm(dataPath, { recursive: true }),
  };
}

void test("a missing file inherits; source reflects user vs project", async () => {
  const user = await setup();
  assert.deepEqual((await user.service.get("p", "c")).compaction, {
    effective: settings(80),
    source: "user",
    inherited: settings(80),
  });
  assert.deepEqual(await user.service.compactionSettings("c"), settings(80));
  await user.cleanup();
  const project = await setup(settings(80), settings(70));
  assert.equal(
    (await project.service.get("p", "c")).compaction.source,
    "project",
  );
  await project.cleanup();
});

void test("a conversation value replaces the inherited one as a whole", async () => {
  const { service, file, changes, cleanup } = await setup();
  const result = await service.update("p", "c", settings(65, false));
  assert.equal(result.compaction.source, "conversation");
  assert.deepEqual(result.compaction.effective, settings(65, false));
  assert.deepEqual(result.compaction.inherited, settings(80));
  assert.deepEqual(JSON.parse(await readFile(file, "utf8")), {
    compaction: settings(65, false),
  });
  assert.deepEqual(await service.compactionSettings("c"), settings(65, false));
  assert.deepEqual(changes, ["c"]);
  await cleanup();
});

void test("saving the inherited value or null prunes the override", async () => {
  const { service, file, cleanup } = await setup();
  await service.update("p", "c", settings(65));
  await service.update("p", "c", settings(80));
  await assert.rejects(stat(file), { code: "ENOENT" });
  await service.update("p", "c", settings(65));
  const result = await service.update("p", "c", null);
  assert.equal(result.compaction.source, "user");
  await assert.rejects(stat(file), { code: "ENOENT" });
  await cleanup();
});

void test("initialize keeps the profile's choice even when it equals the inherited value", async () => {
  const { service, file, cleanup } = await setup();
  await service.initialize("c", settings(80));
  assert.equal((await service.get("p", "c")).compaction.source, "conversation");
  assert.ok(await stat(file));
  await cleanup();
});

void test("legacy conversation retention is stripped on load and omitted on save", async () => {
  const { service, file, cleanup } = await setup();
  try {
    await service.initialize("c", settings(73, false));
    await writeFile(
      file,
      JSON.stringify({
        compaction: { ...settings(73, false), customKeepRecentPercent: 15 },
      }),
    );
    assert.deepEqual(
      await service.compactionSettings("c"),
      settings(73, false),
    );
    await service.update(
      "p",
      "c",
      (await service.get("p", "c")).compaction.effective,
    );
    assert.deepEqual(JSON.parse(await readFile(file, "utf8")), {
      compaction: settings(73, false),
    });
    await writeFile(
      file,
      JSON.stringify({
        compaction: {
          ...settings(73),
          customKeepRecentPercent: 15,
          unknown: true,
        },
      }),
    );
    await assert.rejects(service.compactionSettings("c"));
    await writeFile(
      file,
      JSON.stringify({ compaction: settings(73), unknown: true }),
    );
    await assert.rejects(service.compactionSettings("c"));
  } finally {
    await cleanup();
  }
});
