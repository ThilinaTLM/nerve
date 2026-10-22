import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { after, test } from "node:test";
import { initializeHomeConfiguration } from "./home-configuration.js";
import { defaultSettings } from "@nervekit/contracts/settings";
import {
  readProjectHarnessSettings,
  resolveProjectConfiguration,
  updateProjectHarnessSettings,
} from "./project-configuration.js";
import { storagePaths } from "../storage-bootstrap/paths.js";
import type { InitializedStorage } from "../storage-bootstrap/initialize.js";

const roots: string[] = [];
after(async () => {
  await Promise.all(
    roots.map((root) => rm(root, { recursive: true, force: true })),
  );
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "nerve-project-settings-"));
  roots.push(root);
  const paths = storagePaths(join(root, "home"));
  const configuration = await initializeHomeConfiguration(paths);
  configuration.harness.defaultAgentProfile = "planning";
  const storage = {
    paths,
    configuration,
    settings: { ...defaultSettings, defaultAgentProfile: "planning" },
  } as InitializedStorage;
  const project = join(root, "project");
  const directory = join(project, ".nerve", "config");
  await mkdir(directory, { recursive: true });
  const file = join(directory, "harness.json");
  const read = async () => JSON.parse(await readFile(file, "utf8"));
  return { root, project, file, storage, read };
}

void test("missing project settings inherit user harness without manufacturing overrides", async () => {
  const { storage, project, file } = await fixture();
  const result = await readProjectHarnessSettings(storage, project);
  assert.deepEqual(result.overrides, {});
  assert.equal(result.inherited.defaultAgentProfile, "planning");
  assert.deepEqual(result.effective, result.inherited);
  await assert.rejects(readFile(file), { code: "ENOENT" });
});

void test("concurrent partial saves preserve sibling and extension data; null restores inheritance at any depth", async () => {
  const { storage, project, file, read } = await fixture();
  await writeFile(
    file,
    JSON.stringify({
      version: 4,
      vendor: { untouched: true },
      scopedModels: [
        { provider: "openai", modelId: "first" },
        { provider: "openai", modelId: "second" },
      ],
      defaults: { permissionRuleSetId: "autonomous", vendor: { nested: true } },
    }),
  );
  await Promise.all([
    updateProjectHarnessSettings(storage, project, {
      defaultAgentProfile: "coding",
    }),
    updateProjectHarnessSettings(storage, project, {
      defaults: { thinkingLevel: "high" },
    }),
    updateProjectHarnessSettings(storage, project, {
      compaction: { auto: false },
    }),
    updateProjectHarnessSettings(storage, project, {
      scopedModels: [{ provider: "openai", modelId: "replacement" }],
    }),
  ]);
  const saved = await read();
  assert.equal(saved.defaultAgentProfile, "coding");
  assert.deepEqual(saved.scopedModels, [
    { provider: "openai", modelId: "replacement" },
  ]);
  assert.deepEqual(saved.defaults, {
    permissionRuleSetId: "autonomous",
    thinkingLevel: "high",
    vendor: { nested: true },
  });
  assert.deepEqual(saved.vendor, { untouched: true });
  const result = await updateProjectHarnessSettings(storage, project, {
    defaultAgentProfile: null,
    defaults: { permissionRuleSetId: null },
    compaction: null,
  });
  assert.equal(result.effective.defaultAgentProfile, "planning");
  assert.equal(result.overrides.defaultAgentProfile, undefined);
  assert.equal(result.overrides.defaults?.permissionRuleSetId, undefined);
  assert.equal(result.effective.defaults.thinkingLevel, "high");
  assert.deepEqual((await read()).defaults.vendor, { nested: true });
  assert.equal((await read()).compaction, undefined);
  const resolved = await resolveProjectConfiguration(storage, project, {
    env: {},
    argv: [],
  });
  assert.equal(resolved.harness.defaultAgentProfile, "planning");
  assert.equal(resolved.harness.defaults.thinkingLevel, "high");
});

void test("invalid patches/documents never overwrite the file and later valid saves recover", async () => {
  const { storage, project, file } = await fixture();
  await writeFile(file, '{"defaultAgentProfile":"coding","vendor":true}');
  const original = await readFile(file, "utf8");
  await assert.rejects(
    updateProjectHarnessSettings(storage, project, {
      retry: { maxRetries: -1 },
    }),
  );
  await assert.rejects(
    updateProjectHarnessSettings(storage, project, {
      defaults: { model: { provider: "missing-model-id" } },
    }),
  );
  assert.equal(await readFile(file, "utf8"), original);
  await writeFile(file, '{"defaultAgentProfile":42}');
  await assert.rejects(
    updateProjectHarnessSettings(storage, project, {
      defaultAgentProfile: "planning",
    }),
  );
  assert.equal(await readFile(file, "utf8"), '{"defaultAgentProfile":42}');
  await writeFile(file, original);
  assert.equal(
    (
      await updateProjectHarnessSettings(storage, project, {
        defaultAgentProfile: "planning",
      })
    ).effective.defaultAgentProfile,
    "planning",
  );
});

void test("project harness API rejects symlinked configuration paths without touching the target", async () => {
  const { storage, project, root } = await fixture();
  const outside = join(root, "outside");
  await mkdir(outside);
  await writeFile(join(outside, "harness.json"), "{}");
  await rm(join(project, ".nerve", "config"), { recursive: true });
  await symlink(outside, join(project, ".nerve", "config"));
  await assert.rejects(
    readProjectHarnessSettings(storage, project),
    /symbolic links/,
  );
  await assert.rejects(
    updateProjectHarnessSettings(storage, project, {
      defaultAgentProfile: "coding",
    }),
    /symbolic links/,
  );
  assert.equal(await readFile(join(outside, "harness.json"), "utf8"), "{}");
});

void test("project agent defaults resolve without reading project accounts or app preferences", async () => {
  const { storage, project, file } = await fixture();
  await writeFile(
    file,
    JSON.stringify({ defaults: { thinkingLevel: "medium" } }),
  );
  const configDir = join(project, ".nerve", "config");
  const ignored = ["providers.json", "integrations.json", "ui.json"];
  for (const content of [
    JSON.stringify({
      version: 1,
      profiles: { tavily: [{ id: "project-search", name: "Project account" }] },
      appearance: { colorMode: "light" },
    }),
    "{invalid json",
  ]) {
    for (const name of ignored) await writeFile(join(configDir, name), content);
    const resolved = await resolveProjectConfiguration(storage, project, {
      env: {},
      argv: [],
    });
    assert.equal(resolved.harness.defaults.thinkingLevel, "medium");
    assert.deepEqual(resolved.providers, storage.configuration.providers);
    assert.deepEqual(resolved.integrations, storage.configuration.integrations);
    assert.deepEqual(resolved.ui, storage.configuration.ui);
    for (const name of ignored)
      assert.equal(await readFile(join(configDir, name), "utf8"), content);
  }
});
