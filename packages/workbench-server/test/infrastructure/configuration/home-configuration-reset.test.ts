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
  await writeFile(paths.providersConfigPath, "{ broken");
  await writeFile(paths.uiConfigPath, JSON.stringify({ version: 99 }));
  const configuration = await readHomeConfiguration(paths);
  assert.deepEqual(configuration.providers, defaultUserConfiguration.providers);
  assert.deepEqual(configuration.ui, defaultUserConfiguration.ui);
  const health = await readSettingsHealth(paths);
  assert.deepEqual(
    health.invalid.map((item) => item.id),
    ["ui", "providers"],
  );
  assert.match(
    health.invalid.find((item) => item.id === "providers")!.reason,
    /JSON/,
  );
  await assert.rejects(
    writeHomeConfiguration(paths, configuration, ["providers"]),
    /Reset to defaults.*Reload/,
  );
  // Saving an unrelated document does not rewrite the invalid files.
  await writeHomeConfiguration(paths, configuration, ["daemon"]);
  assert.equal(await readFile(paths.providersConfigPath, "utf8"), "{ broken");
  assert.equal(await readFile(paths.uiConfigPath, "utf8"), '{"version":99}');
});

void test("explicit reset quarantines original bytes and writes defaults; reload reads repairs", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "nerve-config-reset-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const paths = storagePaths(home);
  await initializeHomeConfiguration(paths);
  await writeFile(paths.providersConfigPath, "{ broken");
  await resetHomeConfigurationDocument(paths, "providers");
  assert.deepEqual(
    (await readHomeConfiguration(paths)).providers,
    defaultUserConfiguration.providers,
  );
  const root = join(home, "quarantine", "settings");
  const entries = await readdir(root);
  assert.equal(entries.length, 1);
  const entry = join(root, entries[0]);
  assert.equal(
    await readFile(join(entry, "payload", "providers.json"), "utf8"),
    "{ broken",
  );
  const reasonPath = join(entry, "reason.json");
  const reason = JSON.parse(await readFile(reasonPath, "utf8"));
  assert.equal(reason.kind, "configuration");
  assert.equal(reason.id, paths.providersConfigPath);
  assert.equal(reason.originalPath, paths.providersConfigPath);
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

void test("all five preserved documents can be invalid without blocking configuration reads", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "nerve-config-six-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const paths = storagePaths(home);
  await initializeHomeConfiguration(paths);
  const ids = [
    "daemon",
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
  assert.equal((await readSettingsHealth(paths)).invalid.length, 5);
  for (const id of ids)
    assert.equal(
      await readFile(join(paths.configPath, `${id}.json`), "utf8"),
      "broken",
    );
});
