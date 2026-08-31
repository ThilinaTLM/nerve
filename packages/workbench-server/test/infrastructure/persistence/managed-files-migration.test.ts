import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  CONSOLIDATE_MANAGED_FILES_MIGRATION,
  consolidateManagedFiles,
  recordConsolidatedManagedFiles,
} from "../../../src/infrastructure/migrations/consolidate-managed-files.js";
import { storagePaths } from "../../../src/infrastructure/storage-bootstrap/index.js";

async function fixtureHome(): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), "nerve-managed-files-"));
  await mkdir(join(home, "migrations"), { recursive: true });
  await writeFile(
    join(home, "migrations", "ledger.json"),
    `${JSON.stringify({
      format: "nerve-home-migrations",
      version: 1,
      entries: [{ id: "nerve-home-v1", appliedAt: new Date().toISOString() }],
    })}\n`,
  );
  return home;
}

test("relocates task and conversation-owned files into compact data paths", async (t) => {
  const home = await fixtureHome();
  t.after(() => rm(home, { recursive: true, force: true }));
  const oldTask = join(home, "tasks", "task_ALPHA", "stdout.txt");
  const oldResult = join(
    home,
    "data",
    "payloads",
    "conversations",
    "conv_ALPHA",
    "tool-calls",
    "tool_BETA",
    "result.json",
  );
  const oldArtifact = join(
    home,
    "data",
    "payloads",
    "conversations",
    "conv_ALPHA",
    "tool-calls",
    "tool_BETA",
    "files",
    "result.json",
  );
  await mkdir(join(oldTask, ".."), { recursive: true });
  await mkdir(join(oldArtifact, ".."), { recursive: true });
  await Promise.all([
    writeFile(oldTask, "task output"),
    writeFile(oldResult, '{"ok":true}\n'),
    writeFile(oldArtifact, "tool-owned result filename"),
  ]);

  const paths = storagePaths(home);
  await consolidateManagedFiles(paths);
  await consolidateManagedFiles(paths);
  await recordConsolidatedManagedFiles(paths);
  await consolidateManagedFiles(paths);

  assert.equal(
    await readFile(join(paths.tasksPath, "task_ALPHA", "stdout.txt"), "utf8"),
    "task output",
  );
  const compactCall = join(
    paths.conversationsPath,
    "ALPHA",
    "tool-calls",
    "BETA",
  );
  assert.equal(
    await readFile(join(compactCall, "result.json"), "utf8"),
    '{"ok":true}\n',
  );
  assert.equal(
    await readFile(join(compactCall, "files", "result.json"), "utf8"),
    "tool-owned result filename",
  );
  await assert.rejects(stat(join(home, "tasks")), { code: "ENOENT" });
  await assert.rejects(stat(join(home, "data", "payloads")), {
    code: "ENOENT",
  });
  const ledger = JSON.parse(
    await readFile(paths.migrationLedgerPath, "utf8"),
  ) as { entries: Array<{ id: string }> };
  assert.equal(
    ledger.entries.filter(
      (entry) => entry.id === CONSOLIDATE_MANAGED_FILES_MIGRATION,
    ).length,
    1,
  );
});

test("fails closed when old and compact roots both contain data", async (t) => {
  const home = await fixtureHome();
  t.after(() => rm(home, { recursive: true, force: true }));
  await mkdir(join(home, "tasks", "task_OLD"), { recursive: true });
  await mkdir(join(home, "data", "tasks", "task_NEW"), { recursive: true });
  await Promise.all([
    writeFile(join(home, "tasks", "task_OLD", "stdout.txt"), "old"),
    writeFile(join(home, "data", "tasks", "task_NEW", "stdout.txt"), "new"),
  ]);

  await assert.rejects(
    consolidateManagedFiles(storagePaths(home)),
    /both .* contain data/i,
  );
});
