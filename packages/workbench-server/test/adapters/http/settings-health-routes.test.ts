import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { defaultUserConfiguration } from "@nervekit/contracts/settings";
import { createSettingsHealthRoutes } from "../../../src/adapters/http/routes/settings-health-routes.js";
import {
  initializeHomeConfiguration,
  settingsFromConfiguration,
} from "../../../src/infrastructure/configuration/home-configuration.js";
import {
  writeSettings,
  type InitializedStorage,
} from "../../../src/infrastructure/storage-bootstrap/initialize.js";
import type { CoreStorage } from "@nervekit/conversation-core";
import { createPermissionPort } from "../../../src/core-host/permission.adapter.js";
import { ProviderCatalogStore } from "../../../src/domains/providers/provider-catalog.store.js";
import { WorkbenchNoticePublisher } from "../../../src/infrastructure/events/index.js";
import { storagePaths } from "../../../src/infrastructure/storage-bootstrap/paths.js";

void test("settings health is nonblocking and reset/reload refresh the runtime projection", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "nerve-settings-health-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const paths = storagePaths(home);
  const configuration = await initializeHomeConfiguration(paths);
  const storage: InitializedStorage = {
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
  const events = new WorkbenchNoticePublisher();
  const notices: string[] = [];
  events.subscribeNotify((event) => notices.push(event.type));
  const providerCatalog = new ProviderCatalogStore(storage);
  await providerCatalog.load();
  const app = createSettingsHealthRoutes({ storage, events, providerCatalog });
  const resolve = (id: string, action: string) =>
    app.request("/settings/health/resolve", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id, action }),
    });
  await writeFile(paths.uiConfigPath, "broken");
  await assert.rejects(
    writeSettings(storage, { ui: storage.settings.ui }),
    /Reset to defaults.*Reload/,
  );
  await writeSettings(storage, { logging: storage.settings.logging });
  assert.equal(await readFile(paths.uiConfigPath, "utf8"), "broken");
  const notice = await app.request("/settings/health");
  assert.equal(notice.status, 200);
  assert.equal((await notice.json()).invalid[0].id, "ui");
  assert.equal((await resolve("../../other", "reset")).status, 400);
  const stillInvalid = await resolve("ui", "reload");
  assert.equal((await stillInvalid.json()).invalid.length, 1);
  assert.equal(await readFile(paths.uiConfigPath, "utf8"), "broken");
  assert.deepEqual(notices, []);
  const repaired = structuredClone(defaultUserConfiguration.ui);
  repaired.appearance.colorMode = "dark";
  await writeFile(paths.uiConfigPath, JSON.stringify(repaired));
  assert.deepEqual(await (await resolve("ui", "reload")).json(), {
    invalid: [],
  });
  assert.equal(storage.settings.ui.colorMode, "dark");
  assert.deepEqual(notices.splice(0), ["settings.updated"]);
  await writeFile(paths.uiConfigPath, "broken again");
  assert.deepEqual(await (await resolve("ui", "reset")).json(), {
    invalid: [],
  });
  assert.deepEqual(storage.configuration.ui, defaultUserConfiguration.ui);
  assert.equal((await resolve("ui", "reset")).status, 409);
  notices.splice(0);
  await writeFile(paths.providersConfigPath, "broken providers");
  await app.request("/settings/health");
  await writeFile(
    paths.providersConfigPath,
    JSON.stringify({
      ...defaultUserConfiguration.providers,
      providers: [
        {
          id: "local",
          displayName: "Local test",
          api: "openai-completions",
          baseUrl: "http://localhost:9999",
          headers: {},
        },
      ],
      models: [
        {
          provider: "local",
          modelId: "test",
          name: "Test model",
          reasoning: false,
          supportedThinkingLevels: ["off"],
          input: ["text"],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: 4096,
          maxTokens: 512,
        },
      ],
    }),
  );
  const providerReload = await resolve("providers", "reload");
  assert.equal(providerReload.status, 200);
  assert.deepEqual(await providerReload.json(), { invalid: [] });
  assert.equal(
    providerCatalog.providerDisplayNames().get("local"),
    "Local test",
  );
  assert.equal(
    providerCatalog.resolvedModels()[0].baseUrl,
    "http://localhost:9999",
  );
  assert.deepEqual(notices.splice(0), [
    "providers.catalog_changed",
    "auth.providers_changed",
    "settings.updated",
  ]);
  await writeFile(paths.providersConfigPath, "broken providers again");
  await app.request("/settings/health");
  assert.equal((await resolve("providers", "reset")).status, 200);
  assert.equal(providerCatalog.providerDisplayNames().size, 0);
  assert.deepEqual(providerCatalog.resolvedModels(), []);
  assert.deepEqual(notices, [
    "providers.catalog_changed",
    "auth.providers_changed",
    "settings.updated",
  ]);
  const permissionPort = createPermissionPort(home, {
    conversations: { get: () => ({ projectId: "project" }) },
    trustedResources: { find: () => undefined },
  } as unknown as CoreStorage);
  const input = {
    conversationId: "conversation",
    projectDir: home,
    cwd: home,
    ruleSetId: "autonomous",
    toolName: "bash",
    args: { command: "pwd" },
    origin: "user" as const,
  };
  await writeFile(paths.permissionsConfigPath, "broken permissions");
  await app.request("/settings/health");
  assert.equal((await permissionPort.evaluate(input)).decision, "approval");
  await writeFile(
    paths.permissionsConfigPath,
    JSON.stringify({
      schemaVersion: 2,
      overlays: [
        {
          ruleSetId: "autonomous",
          rules: [
            {
              id: "deny-bash",
              description: "Deny bash",
              enabled: true,
              priority: 100,
              enforcement: "overridable",
              when: { toolNames: ["bash"] },
              decision: "deny",
            },
          ],
        },
      ],
    }),
  );
  assert.equal((await resolve("permissions", "reload")).status, 200);
  assert.equal((await permissionPort.evaluate(input)).decision, "deny");
  await writeFile(paths.permissionsConfigPath, "broken permissions again");
  await app.request("/settings/health");
  assert.equal((await resolve("permissions", "reset")).status, 200);
  assert.equal((await permissionPort.evaluate(input)).decision, "allow");
});
