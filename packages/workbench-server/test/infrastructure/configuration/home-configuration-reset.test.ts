import assert from "node:assert/strict";
import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { defaultUserConfiguration } from "@nervekit/contracts/settings";
import {
  initializeHomeConfiguration,
  readHomeConfiguration,
  readSettingsHealth,
  isHomeConfigurationInvalid,
  revalidateHomeConfigurationAfterMigration,
  reloadHomeConfigurationDocument,
  resetHomeConfigurationDocument,
  writeHomeConfiguration,
} from "../../../src/infrastructure/configuration/home-configuration.js";
import { storagePaths } from "../../../src/infrastructure/storage-bootstrap/paths.js";

void test("invalid documents use defaults without overwriting sources and reject targeted saves", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "nerve-config-defaults-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const paths = storagePaths(home);
  await initializeHomeConfiguration(paths);
  await writeFile(paths.harnessConfigPath, "{ broken");
  await writeFile(paths.uiConfigPath, JSON.stringify({ version: 99 }));
  const configuration = await readHomeConfiguration(paths);
  assert.deepEqual(configuration.harness, defaultUserConfiguration.harness);
  assert.deepEqual(configuration.ui, defaultUserConfiguration.ui);
  const health = await readSettingsHealth(paths);
  assert.deepEqual(
    health.invalid.map((item) => item.id),
    ["harness", "ui"],
  );
  assert.match(health.invalid[0].reason, /JSON/);
  await assert.rejects(
    writeHomeConfiguration(paths, configuration, ["harness"]),
    /Reset to defaults.*Reload/,
  );
  // Saving an unrelated document does not rewrite the invalid files.
  await writeHomeConfiguration(paths, configuration, ["daemon"]);
  assert.equal(await readFile(paths.harnessConfigPath, "utf8"), "{ broken");
  assert.equal(await readFile(paths.uiConfigPath, "utf8"), '{"version":99}');
});

void test("explicit reset quarantines original bytes and writes defaults; reload reads repairs", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "nerve-config-reset-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const paths = storagePaths(home);
  await initializeHomeConfiguration(paths);
  await writeFile(paths.harnessConfigPath, "{ broken");
  await resetHomeConfigurationDocument(paths, "harness");
  assert.deepEqual(
    (await readHomeConfiguration(paths)).harness,
    defaultUserConfiguration.harness,
  );
  const root = join(home, "quarantine", "settings");
  const entries = await readdir(root);
  assert.equal(entries.length, 1);
  const entry = join(root, entries[0]);
  assert.equal(
    await readFile(join(entry, "payload", "harness.json"), "utf8"),
    "{ broken",
  );
  const reasonPath = join(entry, "reason.json");
  const reason = JSON.parse(await readFile(reasonPath, "utf8"));
  assert.equal(reason.kind, "configuration");
  assert.equal(reason.id, paths.harnessConfigPath);
  assert.equal(reason.originalPath, paths.harnessConfigPath);
  assert.ok(reason.reason);
  assert.ok(reason.quarantinedAt);
  assert.equal((await stat(reasonPath)).mode & 0o777, 0o600);
  await writeFile(paths.uiConfigPath, "bad json");
  assert.equal((await readSettingsHealth(paths)).invalid.length, 1);
  await writeFile(
    paths.uiConfigPath,
    JSON.stringify(defaultUserConfiguration.ui),
  );
  assert.equal((await readSettingsHealth(paths)).invalid.length, 1);
  await assert.rejects(
    writeHomeConfiguration(paths, await readHomeConfiguration(paths), ["ui"]),
    /Reload first/,
  );
  await reloadHomeConfigurationDocument(paths, "ui");
  assert.deepEqual(await readSettingsHealth(paths), { invalid: [] });
  await assert.rejects(
    resetHomeConfigurationDocument(paths, "ui"),
    /no longer invalid/,
  );
});

void test("all six runtime documents can be invalid without blocking configuration reads", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "nerve-config-six-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const paths = storagePaths(home);
  await initializeHomeConfiguration(paths);
  const ids = [
    "daemon",
    "harness",
    "ui",
    "permissions",
    "providers",
    "integrations",
  ] as const;
  for (const id of ids)
    await writeFile(join(paths.configPath, `${id}.json`), "broken");
  assert.deepEqual(
    await readHomeConfiguration(paths),
    defaultUserConfiguration,
  );
  assert.deepEqual(
    (await readSettingsHealth(paths)).invalid.map((item) => item.id),
    ids,
  );
  await revalidateHomeConfigurationAfterMigration(paths);
  assert.equal((await readSettingsHealth(paths)).invalid.length, 6);
  for (const id of ids)
    assert.equal(
      await readFile(join(paths.configPath, `${id}.json`), "utf8"),
      "broken",
    );
});

void test("successful migration clears pre-bind legacy schema failures, but no-op startup retains manual-repair recovery", async (t) => {
  const { fixture } =
    await import("../../../src/infrastructure/migrations/steps/0001-conversation-core/step-fixture.js");
  const { initializeStorage, readCurrentSettingsForBootstrap } =
    await import("../../../src/infrastructure/storage-bootstrap/initialize.js");
  const { EncryptedFileSecretProvider } =
    await import("../../../src/infrastructure/secrets/index.js");
  const home = await fixture(t);
  const paths = storagePaths(home);
  await initializeHomeConfiguration(paths);
  await new EncryptedFileSecretProvider(home).initialize();
  const legacy = {
    ...defaultUserConfiguration.harness,
    defaults: {
      ...defaultUserConfiguration.harness.defaults,
      permissionRuleSetId: "read_only",
      permissionLevel: "autonomous",
    },
  };
  await writeFile(paths.harnessConfigPath, JSON.stringify(legacy));
  // Match main.ts: bind settings are read before the migration worker starts.
  await readCurrentSettingsForBootstrap(home);
  assert.equal(isHomeConfigurationInvalid(paths.harnessConfigPath), true);
  assert.match(
    (await readSettingsHealth(paths)).invalid.find(
      (item) => item.id === "harness",
    )?.reason ?? "",
    /permissionLevel/,
  );
  const storage = await initializeStorage(home, {
    localToken: "fixture-token",
  });
  assert.equal(
    storage.configuration.harness.defaults.permissionRuleSetId,
    "read_only",
  );
  assert.equal(storage.settings.defaultPermissionRuleSetId, "read_only");
  assert.equal(isHomeConfigurationInvalid(paths.harnessConfigPath), false);
  assert.deepEqual(await readSettingsHealth(paths), { invalid: [] });
  const convertedBytes = await readFile(paths.harnessConfigPath, "utf8");
  const converted = JSON.parse(convertedBytes);
  assert.equal("permissionLevel" in converted.defaults, false);
  assert.equal(await readFile(paths.harnessConfigPath, "utf8"), convertedBytes);
  // A later startup with no applied steps is not a trusted conversion boundary.
  await writeFile(paths.harnessConfigPath, "{ manually broken");
  await readHomeConfiguration(paths);
  await writeFile(paths.harnessConfigPath, convertedBytes);
  const reopened = await initializeStorage(home, {
    localToken: "fixture-token",
  });
  assert.deepEqual(
    reopened.configuration.harness,
    defaultUserConfiguration.harness,
  );
  assert.equal(isHomeConfigurationInvalid(paths.harnessConfigPath), true);
  assert.equal(await readFile(paths.harnessConfigPath, "utf8"), convertedBytes);
});
