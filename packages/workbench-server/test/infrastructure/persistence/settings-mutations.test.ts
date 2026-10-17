import assert from "node:assert/strict";
import fs, { mkdtemp, rm } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import {
  initializeHomeConfiguration,
  readHomeConfiguration,
  settingsFromConfiguration,
} from "../../../src/infrastructure/configuration/home-configuration.js";
import {
  type InitializedStorage,
  writeSettings,
} from "../../../src/infrastructure/storage-bootstrap/initialize.js";
import { storagePaths } from "../../../src/infrastructure/storage-bootstrap/paths.js";
import { ProviderCatalogStore } from "../../../src/domains/providers/provider-catalog.store.js";

const roots: string[] = [];
after(async () => {
  await Promise.all(
    roots.map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function createStorage(): Promise<InitializedStorage> {
  const home = await mkdtemp(join(tmpdir(), "nerve-settings-"));
  roots.push(home);
  const paths = storagePaths(home);
  const configuration = await initializeHomeConfiguration(paths);
  return {
    paths,
    configuration,
    settings: settingsFromConfiguration(configuration),
    localToken: "test",
    timings: {
      homeInspectionMs: 0,
      sqliteMigrationCheckMs: 0,
      sqliteMigrationApplyMs: 0,
      canonicalOpenMs: 0,
    },
  };
}

async function assertReload(storage: InitializedStorage) {
  const reloaded = await readHomeConfiguration(storage.paths);
  assert.deepEqual(reloaded, JSON.parse(JSON.stringify(storage.configuration)));
  assert.deepEqual(settingsFromConfiguration(reloaded), storage.settings);
}

test("concurrent independent and nested settings patches survive save/reload", async () => {
  const storage = await createStorage();
  await Promise.all([
    writeSettings(storage, {
      skills: { nerve: { enabled: ["skill-creator"] } },
    }),
    writeSettings(storage, { skills: { agentBrowser: { enabled: ["core"] } } }),
    writeSettings(storage, { runtime: { shellPath: "/test/shell" } }),
  ]);
  assert.deepEqual(storage.settings.skills.nerve.enabled, ["skill-creator"]);
  assert.deepEqual(storage.settings.skills.agentBrowser.enabled, ["core"]);
  assert.equal(storage.settings.runtime.shellPath, "/test/shell");
  await assertReload(storage);
});

test("validation rejection leaves authoritative state unchanged and queue usable", async () => {
  const storage = await createStorage();
  const before = storage.settings;
  const invalid = writeSettings(storage, {
    application: { network: { port: -1 } },
  });
  await assert.rejects(invalid);
  assert.equal(storage.settings, before);
  await assertReload(storage);
  const rejected = writeSettings(storage, {
    application: { network: { port: -1 } },
  });
  const saved = writeSettings(storage, {
    skills: { nerve: { enabled: ["core"] } },
  });
  await assert.rejects(rejected);
  await saved;
  assert.deepEqual(storage.settings.skills.nerve.enabled, ["core"]);
  await assertReload(storage);
});

test("persistence rejection leaves runtime state unchanged and later saves recover", async (t) => {
  const storage = await createStorage();
  const before = storage.configuration;
  const settingsBefore = storage.settings;
  const failure = Object.assign(
    new Error("Injected configuration write failure"),
    {
      code: "EIO",
    },
  );
  const rename = fs.rename;
  // Fail the actual harness replacement, after validation and health preflight.
  // A skills patch does not write daemon.json; breaking that path cannot test this.
  const mockedRename = t.mock.method(fs, "rename", async (source, target) => {
    if (target === storage.paths.harnessConfigPath) throw failure;
    return rename(source, target);
  });
  syncBuiltinESMExports();
  try {
    await assert.rejects(
      writeSettings(storage, { skills: { nerve: { enabled: ["core"] } } }),
      (error) => error === failure,
    );
    assert.equal(storage.configuration, before);
    assert.equal(storage.settings, settingsBefore);
    await assertReload(storage);
  } finally {
    mockedRename.mock.restore();
    syncBuiltinESMExports();
  }
  await writeSettings(storage, { skills: { nerve: { enabled: ["core"] } } });
  await assertReload(storage);
});

test("computed patches read the latest committed settings inside the queue", async () => {
  const storage = await createStorage();
  await Promise.all([
    writeSettings(storage, { runtime: { shellPath: "/new/shell" } }),
    writeSettings(storage, (current) => ({
      runtime: { pythonExecutablePath: current.runtime.shellPath },
    })),
  ]);
  assert.equal(storage.settings.runtime.pythonExecutablePath, "/new/shell");
  await assertReload(storage);
});

test("provider catalog and settings mutations share serialization without lost updates", async () => {
  const storage = await createStorage();
  const store = new ProviderCatalogStore(storage);
  await store.load();
  const provider = (id: string) => ({
    id,
    displayName: id,
    api: "openai-completions" as const,
    baseUrl: "https://example.com/v1",
    headers: {},
  });
  await Promise.all([
    store.upsertProvider(provider("first")),
    writeSettings(storage, { skills: { nerve: { enabled: ["core"] } } }),
    store.upsertProvider(provider("second")),
    writeSettings(storage, { runtime: { shellPath: "/new/shell" } }),
  ]);
  assert.deepEqual(
    store.catalog.providers.map((item) => item.id),
    ["first", "second"],
  );
  assert.deepEqual(storage.settings.skills.nerve.enabled, ["core"]);
  assert.equal(storage.settings.runtime.shellPath, "/new/shell");
  await assertReload(storage);
});
