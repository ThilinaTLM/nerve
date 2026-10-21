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
import {
  initializeHomeConfiguration,
  settingsFromConfiguration,
} from "./home-configuration.js";
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
    settings: settingsFromConfiguration(configuration),
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
      version: 3,
      vendor: { untouched: true },
      scopedModels: [
        { provider: "openai", modelId: "first" },
        { provider: "openai", modelId: "second" },
      ],
      execution: { shellPath: "/project/shell", vendor: { nested: true } },
      tools: { bash: { autoPromotion: { enabled: false } } },
    }),
  );
  await Promise.all([
    updateProjectHarnessSettings(storage, project, {
      defaultAgentProfile: "coding",
    }),
    updateProjectHarnessSettings(storage, project, {
      execution: { pythonExecutablePath: "/project/python" },
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
  assert.deepEqual(saved.execution, {
    shellPath: "/project/shell",
    pythonExecutablePath: "/project/python",
    vendor: { nested: true },
  });
  assert.deepEqual(saved.vendor, { untouched: true });
  assert.deepEqual(saved.tools, {
    bash: { autoPromotion: { enabled: false } },
  });
  const result = await updateProjectHarnessSettings(storage, project, {
    defaultAgentProfile: null,
    execution: { shellPath: null },
    compaction: null,
  });
  assert.equal(result.effective.defaultAgentProfile, "planning");
  assert.equal(result.overrides.defaultAgentProfile, undefined);
  assert.equal(result.overrides.execution?.shellPath, undefined);
  assert.equal(
    result.effective.execution.pythonExecutablePath,
    "/project/python",
  );
  assert.deepEqual((await read()).execution.vendor, { nested: true });
  assert.equal((await read()).compaction, undefined);
  const resolved = await resolveProjectConfiguration(storage, project, {
    env: {},
    argv: [],
  });
  assert.equal(resolved.harness.defaultAgentProfile, "planning");
  assert.equal(
    resolved.harness.execution.pythonExecutablePath,
    "/project/python",
  );
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
