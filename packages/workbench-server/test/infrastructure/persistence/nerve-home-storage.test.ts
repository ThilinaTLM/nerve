import assert from "node:assert/strict";
import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
  mkdir,
} from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { defaultSettings } from "@nervekit/contracts/settings";
import { TaskRepository } from "../../../src/domains/tasks/persistence/task.repository.js";
import { ToolResultPayloadStore } from "../../../src/domains/tools/artifacts/tool-result-payload-store.js";
import { resolveProjectSettings } from "../../../src/infrastructure/configuration/index.js";
import { EncryptedFileSecretProvider } from "../../../src/infrastructure/secrets/index.js";
import {
  initializeStorage,
  inspectNerveHome,
} from "../../../src/infrastructure/storage-bootstrap/index.js";

async function temporaryHome(prefix: string) {
  return mkdtemp(join(tmpdir(), prefix));
}

test("initializes the required v1 home and keeps optional directories lazy", async (t) => {
  const home = await temporaryHome("nerve-home-v1-");
  const progress: string[] = [];
  const storage = await initializeStorage(home, {
    reportStartupProgress: (event) => progress.push(event.phase),
  });
  const resources: { database?: DatabaseSync } = {};
  t.after(async () => {
    resources.database?.close();
    await storage.canonicalStore.close();
    await rm(home, { recursive: true, force: true });
  });

  assert.deepEqual(
    JSON.parse(await readFile(storage.paths.manifestPath, "utf8")),
    {
      format: "nerve-home",
      version: 1,
    },
  );
  for (const path of [
    storage.paths.daemonConfigPath,
    storage.paths.harnessConfigPath,
    storage.paths.uiConfigPath,
    storage.paths.permissionsConfigPath,
    storage.paths.providersConfigPath,
    storage.paths.integrationsConfigPath,
    storage.paths.masterKeyPath,
    storage.paths.credentialsPath,
    storage.paths.localTokenPath,
    storage.paths.sqlitePath,
    storage.paths.migrationLedgerPath,
  ]) {
    assert.equal((await stat(path)).isFile(), true, path);
  }
  if (process.platform !== "win32") {
    assert.equal((await stat(storage.paths.home)).mode & 0o777, 0o700);
    assert.equal((await stat(storage.paths.secretsPath)).mode & 0o777, 0o700);
    assert.equal(
      (await stat(storage.paths.localTokenPath)).mode & 0o777,
      0o600,
    );
  }
  assert.deepEqual(progress, ["storage-check"]);
  assert.equal(storage.timings.sqliteMigrationApplyMs, 0);
  assert.ok(storage.timings.canonicalOpenMs >= 0);
  assert.equal((await stat(storage.paths.tasksPath)).isDirectory(), true);
  assert.equal(
    (await stat(storage.paths.conversationsPath)).isDirectory(),
    true,
  );
  await assert.rejects(stat(join(home, "tasks")), { code: "ENOENT" });
  await assert.rejects(stat(join(home, "data", "payloads")), {
    code: "ENOENT",
  });
  await assert.rejects(stat(storage.paths.agentPath), { code: "ENOENT" });
  await assert.rejects(stat(storage.paths.suggestionsPath), { code: "ENOENT" });

  resources.database = new DatabaseSync(storage.paths.sqlitePath, {
    readOnly: true,
  });
  const tables = resources.database
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
    .all()
    .map((row) => String((row as { name: unknown }).name));
  assert.equal(tables.includes("settings_store"), false);
  assert.equal(tables.includes("file_assets"), true);
});

test("fails closed on every non-empty unmanifested or unsupported home", async (t) => {
  const home = await temporaryHome("nerve-home-unsupported-");
  t.after(() => rm(home, { recursive: true, force: true }));
  await writeFile(join(home, "VERSION"), "2\n");
  const before = await readdir(home);
  await assert.rejects(
    initializeStorage(home),
    /does not import older storage layouts/,
  );
  assert.deepEqual(await readdir(home), before);
  assert.equal((await inspectNerveHome(home)).kind, "unsupported");

  const other = await temporaryHome("nerve-home-version-");
  t.after(() => rm(other, { recursive: true, force: true }));
  await writeFile(
    join(other, "manifest.json"),
    JSON.stringify({ format: "nerve-home", version: 2 }),
  );
  await assert.rejects(initializeStorage(other), /not nerve-home version 1/);
  assert.deepEqual(await readdir(other), ["manifest.json"]);
});

test("encrypts secrets and resolves project configuration precedence", async (t) => {
  const home = await temporaryHome("nerve-home-config-");
  const project = await temporaryHome("nerve-project-config-");
  t.after(() => rm(project, { recursive: true, force: true }));
  const storage = await initializeStorage(home);
  t.after(async () => {
    await storage.canonicalStore.close();
    await rm(home, { recursive: true, force: true });
  });
  const secrets = new EncryptedFileSecretProvider(home);
  const value = "secret-value-that-must-not-be-plaintext";
  await secrets.set("provider:test", value);
  assert.equal(
    (await readFile(storage.paths.credentialsPath, "utf8")).includes(value),
    false,
  );
  assert.equal(
    (await readFile(storage.paths.sqlitePath)).includes(Buffer.from(value)),
    false,
  );

  const configDir = join(project, ".nerve", "config");
  await mkdir(configDir, { recursive: true });
  await writeFile(
    join(configDir, "harness.json"),
    `${JSON.stringify({ version: 1, defaults: { mode: "planning" } })}\n`,
  );
  const projectSettings = await resolveProjectSettings(storage, project, {
    env: { NERVE_DEFAULT_MODE: "coding" },
    argv: ["--default-mode=planning"],
  });
  assert.equal(projectSettings.defaultMode, "planning");
  assert.equal(
    projectSettings.defaultPermissionLevel,
    defaultSettings.defaultPermissionLevel,
  );
});

test("persists logical managed-file references and materializes absolute paths", async (t) => {
  const home = await temporaryHome("nerve-home-references-");
  const storage = await initializeStorage(home);
  t.after(async () => {
    await storage.canonicalStore.close();
    await rm(home, { recursive: true, force: true });
  });
  const tasks = new TaskRepository(storage);
  const now = new Date().toISOString();
  const paths = tasks.paths("task_reference");
  const logsPath = paths.eventsPath;
  await tasks.write({
    id: "task_reference",
    cwd: "/tmp/project",
    command: "printf test",
    status: "completed",
    readiness: { outcome: "pending" },
    stdoutPath: paths.stdoutPath,
    stderrPath: paths.stderrPath,
    combinedPath: paths.combinedPath,
    logsPath,
    startedAt: now,
    updatedAt: now,
  });
  const persisted = await storage.canonicalStore.readDocument<
    Record<string, unknown>
  >("task", "global", "task_reference");
  assert.equal(persisted?.data.logsPath, "tasks/task_reference/events.jsonl");
  const hydrated = (await tasks.hydrate())[0];
  assert.equal(hydrated?.logsPath, logsPath);
  assert.equal(hydrated?.stdoutPath, paths.stdoutPath);
  assert.equal(hydrated?.stderrPath, paths.stderrPath);
  assert.equal(hydrated?.combinedPath, paths.combinedPath);

  const payloads = new ToolResultPayloadStore(home);
  const reference = await payloads.write("conv_reference", "tool_reference", {
    ok: true,
  });
  assert.equal(
    reference.logicalPath,
    "conversations/reference/tool-calls/reference/result.json",
  );
  assert.equal(payloads.path(reference).startsWith(home), true);
});
