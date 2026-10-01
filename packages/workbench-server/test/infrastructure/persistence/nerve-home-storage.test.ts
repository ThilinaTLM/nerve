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
import { STORAGE_READ_COMPATIBILITY_ID } from "../../../src/infrastructure/storage-migrations/read-compatibility.js";
import {
  initializeStorage,
  inspectNerveHome,
  writeSettings,
} from "../../../src/infrastructure/storage-bootstrap/index.js";

async function temporaryHome(prefix: string) {
  return mkdtemp(join(tmpdir(), prefix));
}

test("initializes the current home through the storage migration chain", async (t) => {
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
      version: 2,
      homeClass: "standard",
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
  assert.deepEqual(progress, ["storage-check", "storage-migration"]);
  assert.ok(storage.timings.sqliteMigrationApplyMs >= 0);
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
  for (const path of [
    join(home, "data", "idempotency"),
    join(home, "data", "maintenance"),
    join(home, "data", "permissions"),
    join(home, "runtime"),
  ])
    await assert.rejects(stat(path), { code: "ENOENT" });

  resources.database = new DatabaseSync(storage.paths.sqlitePath, {
    readOnly: true,
  });
  const tables = resources.database
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
    .all()
    .map((row) => String((row as { name: unknown }).name));
  assert.equal(tables.includes("settings_store"), false);
  assert.equal(tables.includes("file_assets"), true);
  const migrationIds = resources.database
    .prepare("SELECT id FROM storage_migrations ORDER BY ordinal")
    .all()
    .map((row) => String((row as { id: unknown }).id));
  assert.deepEqual(migrationIds, [
    "0001-nerve-home-v1",
    "0002-atomic-run-lifecycle-work",
    "0003-authoritative-run-lifecycle",
    "0004-convert-run-lifecycle",
    "0005-async-subagent-completions",
    "0006-explore-agent-names",
    "0007-agent-async-obligations",
    "0008-tool-result-payload-reference",
    "0009-agent-async-obligations-backfill",
    "0010-deletion-indexes",
  ]);
});

test("rechecks released 0.32 readability evidence after reader contract changes", async (t) => {
  const home = await temporaryHome("nerve-home-read-adoption-");
  t.after(() => rm(home, { recursive: true, force: true }));
  const initial = await initializeStorage(home);
  await initial.canonicalStore.close();

  const database = new DatabaseSync(initial.paths.sqlitePath);
  database.exec("DELETE FROM storage_read_sweeps");
  database
    .prepare(
      "INSERT INTO storage_read_sweeps (build_id, swept_at_ms, quarantined) VALUES (?, 1, 0)",
    )
    .run("0.32.2:source");
  database.close();

  const messages: string[] = [];
  const reopened = await initializeStorage(home, {
    reportStartupProgress: (event) => messages.push(event.message),
  });
  await reopened.canonicalStore.close();

  assert.equal(
    messages.includes("Checking stored records for readability"),
    true,
  );
  const verified = new DatabaseSync(initial.paths.sqlitePath, {
    readOnly: true,
  });
  try {
    assert.equal(
      Number(
        verified
          .prepare(
            "SELECT count(*) AS count FROM storage_read_sweeps WHERE build_id = ?",
          )
          .get(STORAGE_READ_COMPATIBILITY_ID)?.count,
      ),
      1,
    );
  } finally {
    verified.close();
  }
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

test("loads older home configuration with missing additive defaults", async (t) => {
  const home = await temporaryHome("nerve-home-config-defaults-");
  const initial = await initializeStorage(home);
  await initial.canonicalStore.close();

  const harness = JSON.parse(
    await readFile(initial.paths.harnessConfigPath, "utf8"),
  ) as {
    skills: { nerve?: unknown };
    asyncSubagent?: unknown;
    tools: { imageGeneration?: unknown };
  };
  delete harness.skills.nerve;
  delete harness.asyncSubagent;
  delete harness.tools.imageGeneration;
  await writeFile(
    initial.paths.harnessConfigPath,
    `${JSON.stringify(harness, null, 2)}\n`,
  );

  const reopened = await initializeStorage(home);
  t.after(async () => {
    await reopened.canonicalStore.close();
    await rm(home, { recursive: true, force: true });
  });

  assert.deepEqual(reopened.configuration.harness.skills.nerve, {
    enabled: [],
  });
  assert.deepEqual(reopened.settings.skills.nerve, { enabled: [] });
  assert.deepEqual(
    reopened.configuration.harness.asyncSubagent,
    defaultSettings.asyncSubagent,
  );
  assert.deepEqual(
    reopened.settings.asyncSubagent,
    defaultSettings.asyncSubagent,
  );
  assert.deepEqual(
    reopened.configuration.harness.tools.imageGeneration,
    defaultSettings.tools.imageGeneration,
  );
  assert.deepEqual(
    reopened.settings.tools.imageGeneration,
    defaultSettings.tools.imageGeneration,
  );
});

test("migrates older Kroki defaults and persists URL edits without toggling enablement", async (t) => {
  const home = await temporaryHome("nerve-home-kroki-");
  t.after(() => rm(home, { recursive: true, force: true }));
  const initial = await initializeStorage(home);
  const harnessPath = initial.paths.harnessConfigPath;
  await initial.canonicalStore.close();
  const legacy = JSON.parse(await readFile(harnessPath, "utf8"));
  legacy.version = 2;
  delete legacy.tools.kroki;
  legacy.tools.disabled = ["explore"];
  await writeFile(harnessPath, JSON.stringify(legacy));
  const migrated = await initializeStorage(home);
  try {
    assert.ok(migrated.settings.tools.disabled.includes("kroki_export"));
    assert.ok(migrated.settings.tools.disabled.includes("explore"));
    await writeSettings(migrated, {
      tools: { kroki: { url: "http://127.0.0.1:9080/kroki" } },
    });
    assert.ok(migrated.settings.tools.disabled.includes("kroki_export"));
    assert.equal(
      migrated.settings.tools.imageGeneration.model,
      defaultSettings.tools.imageGeneration.model,
    );
    await writeSettings(migrated, { tools: { disabled: ["explore"] } });
  } finally {
    await migrated.canonicalStore.close();
  }
  const reopened = await initializeStorage(home);
  try {
    assert.equal(reopened.configuration.harness.version, 3);
    assert.equal(
      reopened.settings.tools.kroki.url,
      "http://127.0.0.1:9080/kroki/",
    );
    assert.deepEqual(reopened.settings.tools.disabled, ["explore"]);
  } finally {
    await reopened.canonicalStore.close();
  }
});

test("persists async teammate settings and clears the model without resetting its profile", async (t) => {
  const home = await temporaryHome("nerve-home-async-settings-");
  const storage = await initializeStorage(home);
  t.after(async () => {
    await storage.canonicalStore.close();
    await rm(home, { recursive: true, force: true });
  });
  const model = { provider: "openai", modelId: "gpt-5" };
  await writeSettings(storage, {
    asyncSubagent: {
      model,
      thinkingLevel: "high",
      compactionProfile: "custom",
      customTriggerPercent: 87,
      customKeepRecentPercent: 9,
    },
  });
  assert.deepEqual(
    storage.configuration.harness.asyncSubagent,
    storage.settings.asyncSubagent,
  );
  assert.deepEqual(storage.settings.asyncSubagent, {
    model,
    thinkingLevel: "high",
    compactionProfile: "custom",
    customTriggerPercent: 87,
    customKeepRecentPercent: 9,
  });
  await writeSettings(storage, {
    asyncSubagent: {
      model: null,
      thinkingLevel: null,
      customKeepRecentPercent: 12,
    },
  });
  const persisted = JSON.parse(
    await readFile(storage.paths.harnessConfigPath, "utf8"),
  ) as { asyncSubagent: Record<string, unknown> };
  assert.deepEqual(persisted.asyncSubagent, {
    compactionProfile: "custom",
    customTriggerPercent: 87,
    customKeepRecentPercent: 12,
  });
  assert.equal(storage.settings.asyncSubagent.model, undefined);
  assert.equal(storage.settings.asyncSubagent.thinkingLevel, undefined);
  assert.deepEqual(
    JSON.parse(JSON.stringify(storage.settings.asyncSubagent)),
    persisted.asyncSubagent,
  );
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
    `${JSON.stringify({ version: 1, defaults: { thinkingLevel: "low" }, asyncSubagent: { model: { provider: "openai", modelId: "gpt-5" }, compactionProfile: "custom", customTriggerPercent: 90 } })}\n`,
  );
  const projectSettings = await resolveProjectSettings(storage, project, {
    env: { NERVE_DEFAULT_PERMISSION_LEVEL: "read_only" },
    argv: ["--default-permission-level=supervised"],
  });
  // Arguments win over environment, which wins over the project harness file.
  assert.equal(projectSettings.defaultPermissionLevel, "supervised");
  assert.equal(projectSettings.defaultThinkingLevel, "low");
  assert.deepEqual(projectSettings.asyncSubagent, {
    model: { provider: "openai", modelId: "gpt-5" },
    compactionProfile: "custom",
    customTriggerPercent: 90,
    customKeepRecentPercent: 15,
  });
  assert.deepEqual(
    storage.settings.asyncSubagent,
    defaultSettings.asyncSubagent,
  );
  assert.notEqual(
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
