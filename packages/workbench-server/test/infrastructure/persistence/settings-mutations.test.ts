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
      ui: { zoomLevel: 2 },
    }),
    writeSettings(storage, { notifications: { soundsEnabled: false } }),
    writeSettings(storage, { desktop: { closeToTray: true } }),
  ]);
  assert.equal(storage.settings.ui.zoomLevel, 2);
  assert.equal(storage.settings.notifications.soundsEnabled, false);
  assert.equal(storage.settings.desktop.closeToTray, true);
  await assertReload(storage);
});

test("conversation title settings persist across reload", async () => {
  const storage = await createStorage();
  const conversationTitles = {
    enabled: true,
    model: { provider: "google", modelId: "gemini-2.5-flash-lite" },
  };
  await writeSettings(storage, { conversationTitles });
  assert.deepEqual(storage.settings.conversationTitles, conversationTitles);
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
    ui: { zoomLevel: 2 },
  });
  await assert.rejects(rejected);
  await saved;
  assert.equal(storage.settings.ui.zoomLevel, 2);
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
  // Fail the UI replacement after validation and health preflight.
  const mockedRename = t.mock.method(fs, "rename", async (source, target) => {
    if (target === storage.paths.uiConfigPath) throw failure;
    return rename(source, target);
  });
  syncBuiltinESMExports();
  try {
    await assert.rejects(
      writeSettings(storage, { ui: { zoomLevel: 2 } }),
      (error) => error === failure,
    );
    assert.equal(storage.configuration, before);
    assert.equal(storage.settings, settingsBefore);
    await assertReload(storage);
  } finally {
    mockedRename.mock.restore();
    syncBuiltinESMExports();
  }
  await writeSettings(storage, { ui: { zoomLevel: 2 } });
  await assertReload(storage);
});

test("computed patches read the latest committed settings inside the queue", async () => {
  const storage = await createStorage();
  await Promise.all([
    writeSettings(storage, { desktop: { closeToTray: true } }),
    writeSettings(storage, (current) => ({
      notifications: { soundsEnabled: !current.desktop.closeToTray },
    })),
  ]);
  assert.equal(storage.settings.notifications.soundsEnabled, false);
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
    writeSettings(storage, { ui: { zoomLevel: 2 } }),
    store.upsertProvider(provider("second")),
    writeSettings(storage, { desktop: { closeToTray: true } }),
  ]);
  assert.deepEqual(
    store.catalog.providers.map((item) => item.id),
    ["first", "second"],
  );
  assert.equal(storage.settings.ui.zoomLevel, 2);
  assert.equal(storage.settings.desktop.closeToTray, true);
  await assertReload(storage);
});
