import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  rm,
  readdir,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { test, type TestContext } from "node:test";
import {
  ProjectMigrationService,
  type ProjectConfigurationType,
} from "../../project-migration/project-migration.js";
import {
  projectAgentConfiguration,
  projectConversationDefaults,
  projectCapabilitiesConfiguration,
  projectIntegrations,
  projectSubagentCatalog,
} from "./scoped-migrations.js";
import { projectProfileConfiguration } from "./profile-migrations.js";
import { projectPermissionsConfiguration } from "../../../../core-host/project-permission-migrations.js";

async function fixture(t: TestContext) {
  const home = await mkdtemp(join(tmpdir(), "project-chains-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const context = { projectId: "p", directory: join(home, "project") };
  const service = new ProjectMigrationService({ home });
  const put = async (path: string, value: unknown) => {
    const file = join(context.directory, ".nerve", path);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(
      file,
      typeof value === "string" ? value : JSON.stringify(value),
    );
    return file;
  };
  return { home, context, service, put };
}
const preferences = { schemaVersion: 1, revision: 0, overrides: {} };
const integrations = { version: 2, profiles: { atlassian: [], tavily: [] } };
const profile = {
  schemaVersion: 1,
  name: "review",
  whenToUse: "Review",
  usableBy: "subagent",
  instructions: "Review carefully",
};
const cases: {
  type: ProjectConfigurationType<unknown>;
  healthy: unknown;
  older?: unknown;
}[] = [
  { type: projectAgentConfiguration, healthy: preferences },
  { type: projectConversationDefaults, healthy: preferences },
  {
    type: projectCapabilitiesConfiguration,
    healthy: {
      schemaVersion: 3,
      overrides: { tools: { web_search: { enabled: false } } },
    },
    older: { schemaVersion: 2, tools: { web_search: { enabled: false } } },
  },
  {
    type: projectIntegrations,
    healthy: integrations,
    older: {
      ...integrations,
      version: 1,
      tools: {
        jira: { enabled: false },
        confluence: { enabled: false },
        web: {},
      },
    },
  },
  {
    type: projectSubagentCatalog,
    healthy: { version: 2, schemaVersion: 1, profiles: {} },
    older: { enabled: { review: false } },
  },
  {
    type: projectProfileConfiguration("review"),
    healthy: { ...profile, version: 2 },
    older: { ...profile, whenToUse: undefined, description: "Review" },
  },
  {
    type: projectPermissionsConfiguration,
    healthy: { schemaVersion: 2, version: 2, overlays: [] },
    older: { schemaVersion: 2, overlays: [] },
  },
];
for (const entry of cases) {
  void test(`${entry.type.id}: healthy, invalid, newer and confirmed reset`, async (t) => {
    const f = await fixture(t);
    const type = entry.type;
    f.service.register(type);
    const file = await f.put(type.path, entry.healthy);
    assert.equal(
      (await f.service.load(f.context, type)).classification,
      "healthy",
    );
    await f.put(type.path, {
      ...(entry.healthy as object),
      [type.version.field]: type.currentVersion + 1,
    });
    const newerBytes = await readFile(file, "utf8");
    assert.equal(
      (await f.service.load(f.context, type)).classification,
      "incompatible",
    );
    await assert.rejects(
      f.service.reset(f.context, type, true),
      /Only corrupted/,
    );
    assert.equal(await readFile(file, "utf8"), newerBytes);
    await f.put(type.path, "broken JSON");
    assert.equal(
      (await f.service.load(f.context, type)).classification,
      "corrupted",
    );
    let called = false;
    await assert.rejects(
      f.service.transact(f.context, type, () => {
        called = true;
        return { result: null, changed: true };
      }),
    );
    assert.equal(called, false);
    await assert.rejects(
      f.service.reset(f.context, type, false),
      /confirmation/,
    );
    assert.equal(
      (await f.service.reset(f.context, type, true)).classification,
      "healthy",
    );
    await assert.rejects(readFile(file), { code: "ENOENT" });
    assert.ok(
      (await readdir(join(f.home, "quarantine/project-configuration"))).length,
    );
  });
  if (entry.older)
    void test(`${entry.type.id}: migrates older bytes and preserves originals`, async (t) => {
      const f = await fixture(t);
      const file = await f.put(entry.type.path, entry.older);
      assert.equal(
        (await f.service.load(f.context, entry.type)).classification,
        "migrated",
      );
      assert.notEqual(
        await readFile(file, "utf8"),
        JSON.stringify(entry.older),
      );
      assert.equal(
        (await f.service.load(f.context, entry.type)).classification,
        "healthy",
      );
    });
}
void test("scoped legacy inputs combine all contributions without losing integration selections", async (t) => {
  const f = await fixture(t);
  const harness = await f.put("config/harness.json", {
    version: 3,
    defaults: { mode: "coding", model: { provider: "test", modelId: "model" } },
    execution: { shellPath: "/bin/sh" },
  });
  const capabilities = await f.put("config/capabilities.json", {
    schemaVersion: 2,
    tools: { web_search: { enabled: false } },
  });
  await f.put("config/subagents.json", {
    schemaVersion: 1,
    profiles: { review: { enabled: false, model: "lead" } },
  });
  await f.put("config/integrations.json", {
    ...integrations,
    version: 1,
    tools: {
      jira: { enabled: false },
      confluence: { enabled: false },
      web: {},
    },
  });
  const loaded = await f.service.load(f.context, projectAgentConfiguration);
  assert.equal(loaded.classification, "migrated");
  const capabilityLayer = await f.service.load(
    f.context,
    projectCapabilitiesConfiguration,
  );
  assert.equal(
    capabilityLayer.value.overrides.tools?.web_search?.enabled,
    false,
  );
  assert.equal(loaded.value.overrides.tools?.jira?.enabled, false);
  assert.equal(
    loaded.value.overrides.tools?.bash?.settings?.shellPath,
    "/bin/sh",
  );
  assert.equal(loaded.value.overrides.subagents?.review?.enabled, false);
  assert.equal(
    (await f.service.load(f.context, projectConversationDefaults))
      .classification,
    "migrated",
  );
  assert.equal(JSON.parse(await readFile(harness, "utf8")).version, 3);
  assert.equal(
    JSON.parse(await readFile(capabilities, "utf8")).schemaVersion,
    3,
  );
});
void test("failed migration does not overwrite sources; reset cannot resurrect retained legacy inputs after restart", async (t) => {
  const f = await fixture(t);
  const original = await f.put("config/harness.json", {
    version: 3,
    unexpected: true,
  });
  assert.equal(
    (await f.service.load(f.context, projectAgentConfiguration)).classification,
    "corrupted",
  );
  await f.service.reset(f.context, projectAgentConfiguration, true);
  assert.equal(JSON.parse(await readFile(original, "utf8")).unexpected, true);
  const restarted = new ProjectMigrationService({ home: f.home });
  assert.equal(
    (await restarted.load(f.context, projectAgentConfiguration)).classification,
    "healthy",
  );
  await assert.rejects(
    readFile(join(f.context.directory, ".nerve/config/agent.json")),
    { code: "ENOENT" },
  );
});
void test("legacy catalog entries isolate conversion failures; Markdown subagents use frozen parsing", async (t) => {
  const f = await fixture(t);
  await f.put("config/subagents.json", {
    schemaVersion: 1,
    profiles: {
      broken: { description: 4 },
      review: {
        label: "Review",
        description: "Review",
        model: "lead",
        thinking: "lead",
        permission: "read_only",
        compaction: "inherit",
        skills: "none",
        instructions: "Review carefully",
      },
    },
  });
  assert.equal(
    (await f.service.load(f.context, projectProfileConfiguration("broken")))
      .classification,
    "corrupted",
  );
  assert.equal(
    (await f.service.load(f.context, projectProfileConfiguration("review")))
      .classification,
    "migrated",
  );
  await f.service.reset(f.context, projectProfileConfiguration("broken"), true);
  assert.equal(
    (await f.service.load(f.context, projectProfileConfiguration("broken")))
      .classification,
    "healthy",
  );
  assert.equal(
    (await f.service.load(f.context, projectProfileConfiguration("review")))
      .classification,
    "healthy",
  );
  await f.put(
    "config/capabilities.json",
    "broken unrelated capability metadata",
  );
  await f.put("config/integrations.json", "broken unrelated integrations");
  await f.put(
    "subagents/worker.md",
    "---\ndescription: Worker\nmodel: lead\nthinking: lead\npermission: read_only\ncompaction: inherit\nskills: none\n---\n\nDo work.\n",
  );
  assert.equal(
    (await f.service.load(f.context, projectProfileConfiguration("worker")))
      .classification,
    "migrated",
  );
  await f.put("config/subagents.json", {
    version: 2,
    enabled: { missing: false },
  });
  assert.equal(
    (await f.service.load(f.context, projectProfileConfiguration("missing")))
      .classification,
    "corrupted",
    "a current invalid catalog is never repaired as an old enablement map",
  );
});

void test("loading integrations first preserves its tool selections in agent settings before retiring the v1 fields", async (t) => {
  const f = await fixture(t);
  await f.put("config/integrations.json", {
    ...integrations,
    version: 1,
    tools: {
      jira: { enabled: false },
      confluence: { enabled: false },
      web: {},
    },
  });
  assert.equal(
    (await f.service.load(f.context, projectIntegrations)).classification,
    "migrated",
  );
  const agent = JSON.parse(
    await readFile(
      join(f.context.directory, ".nerve/config/agent.json"),
      "utf8",
    ),
  );
  assert.equal(agent.overrides.tools.jira.enabled, false);
  assert.equal(agent.overrides.tools.confluence.enabled, false);
  assert.equal(
    JSON.parse(
      await readFile(
        join(f.context.directory, ".nerve/config/integrations.json"),
        "utf8",
      ),
    ).version,
    2,
  );
});
