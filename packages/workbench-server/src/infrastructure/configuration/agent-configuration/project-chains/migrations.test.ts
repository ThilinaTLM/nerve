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
void test("harness and Markdown are notices only; catalog entries never create profile files", async (t) => {
  const f = await fixture(t);
  const harness = await f.put("config/harness.json", "not even JSON");
  const markdown = await f.put("subagents/review.md", "old Markdown");
  await f.put("config/subagents.json", {
    schemaVersion: 1,
    profiles: {
      review: { description: "Old review", instructions: "Do work" },
    },
  });
  assert.equal(
    (await f.service.load(f.context, projectAgentConfiguration)).classification,
    "healthy",
  );
  assert.equal(
    (await f.service.load(f.context, projectConversationDefaults))
      .classification,
    "healthy",
  );
  assert.equal(
    (await f.service.load(f.context, projectSubagentCatalog)).classification,
    "migrated",
  );
  assert.equal(
    (await f.service.load(f.context, projectProfileConfiguration("review")))
      .value,
    null,
  );
  for (const name of [
    "config/agent.json",
    "config/conversation-defaults.json",
    "agent-profiles/review.json",
  ])
    await assert.rejects(readFile(join(f.context.directory, ".nerve", name)), {
      code: "ENOENT",
    });
  assert.equal(await readFile(harness, "utf8"), "not even JSON");
  assert.equal(await readFile(markdown, "utf8"), "old Markdown");
  assert.deepEqual(
    f.service
      .health("p")
      .issues.find((issue) => issue.classification === "legacy")?.files,
    [harness, markdown],
  );
});
void test("integrations bump is independent and never writes tool selections into agent settings", async (t) => {
  const f = await fixture(t);
  await f.put("config/harness.json", "corrupt unrelated legacy settings");
  const file = await f.put("config/integrations.json", {
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
  assert.deepEqual(JSON.parse(await readFile(file, "utf8")), integrations);
  await assert.rejects(
    readFile(join(f.context.directory, ".nerve/config/agent.json")),
    { code: "ENOENT" },
  );
});

void test("permission bump renames only the planning selector, not descriptive text", async (t) => {
  const f = await fixture(t);
  const old = {
    schemaVersion: 2,
    overlays: [
      {
        ruleSetId: "supervised",
        rules: [
          {
            id: "planning",
            description: "plan_mode_present stays in text",
            enabled: true,
            priority: 1,
            enforcement: "overridable",
            when: { toolNames: ["plan_mode_present", "bash"] },
            decision: "prompt",
          },
        ],
      },
    ],
  };
  await f.put(projectPermissionsConfiguration.path, old);
  const migrated = await f.service.load(
    f.context,
    projectPermissionsConfiguration,
  );
  assert.equal(migrated.classification, "migrated");
  const rule = migrated.value.overlays[0].rules[0];
  assert.deepEqual(rule.when?.toolNames, ["plan_present", "bash"]);
  assert.equal(rule.description, "plan_mode_present stays in text");
});
