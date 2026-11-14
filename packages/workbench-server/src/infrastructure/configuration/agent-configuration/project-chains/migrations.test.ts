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
  projectSubagentCatalog,
} from "./scoped-migrations.js";
import { projectProfileConfiguration } from "./profile-migrations.js";
import { projectExtensionsConfiguration } from "../../extensions/project-extensions.js";
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
const movedKeys = {
  jira: { enabled: true, profileId: "acme" },
  generate_image: { enabled: true, settings: { provider: "openai-codex" } },
  quick_script: { enabled: true, settings: { diagram: { url: "https://k/" } } },
  python_exec: { enabled: true },
};
const extensions = { schemaVersion: 1, revision: 0, extensions: {} };
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
  {
    type: projectAgentConfiguration,
    healthy: { ...preferences, version: 2 },
    older: { ...preferences, overrides: { tools: movedKeys } },
  },
  { type: projectExtensionsConfiguration, healthy: extensions },
  { type: projectConversationDefaults, healthy: preferences },
  {
    type: projectCapabilitiesConfiguration,
    healthy: {
      schemaVersion: 4,
      overrides: { tools: { web_search: { enabled: false } } },
    },
    older: { schemaVersion: 2, tools: { web_search: { enabled: false } } },
  },
  {
    type: projectSubagentCatalog,
    healthy: { version: 2, schemaVersion: 1, profiles: {} },
    older: { enabled: { review: false } },
  },
  {
    type: projectProfileConfiguration("review"),
    healthy: { ...profile, version: 3 },
    older: { ...profile, whenToUse: undefined, description: "Review" },
  },
  {
    type: projectPermissionsConfiguration,
    healthy: { schemaVersion: 2, version: 3, overlays: [] },
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
void test("agent settings and capabilities drop keys that moved to extensions, and say so", async (t) => {
  const f = await fixture(t);
  const agent = await f.put("config/agent.json", {
    ...preferences,
    overrides: { tools: movedKeys },
  });
  const upgraded = await f.service.load(f.context, projectAgentConfiguration);
  assert.equal(upgraded.classification, "migrated");
  assert.deepEqual(JSON.parse(await readFile(agent, "utf8")), {
    ...preferences,
    overrides: {
      tools: {
        quick_script: { enabled: true },
        python_exec: { enabled: true },
      },
    },
    version: 2,
  });
  const notice = f.service
    .health("p")
    .issues.find((issue) => issue.type === "agent-settings");
  assert.match(notice?.message ?? "", /moved to Extensions/);
  assert.match(notice?.message ?? "", /Jira, Confluence/);
  const capabilities = await f.put("config/capabilities.json", {
    schemaVersion: 3,
    overrides: { tools: { web_search: { enabled: true, profileId: "tav" } } },
  });
  await f.service.load(f.context, projectCapabilitiesConfiguration);
  assert.deepEqual(JSON.parse(await readFile(capabilities, "utf8")), {
    schemaVersion: 4,
    overrides: { tools: { web_search: { enabled: true } } },
  });
  // Nothing moved: no notice beyond the plain upgrade.
  await f.put("config/agent.json", preferences);
  await f.service.reload(f.context, projectAgentConfiguration);
  assert.doesNotMatch(
    f.service.health("p").issues.find((i) => i.type === "agent-settings")
      ?.message ?? "",
    /moved to Extensions/,
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

void test("permission overlays naming removed tools become quick_script operation rules; unconvertible ones are disabled and reported", async (t) => {
  const f = await fixture(t);
  const rule = (
    id: string,
    priority: number,
    when: object,
    decision: string,
  ) => ({
    id,
    enabled: true,
    priority,
    enforcement: "overridable",
    when,
    decision,
  });
  const old = {
    version: 2,
    schemaVersion: 2,
    overlays: [
      {
        ruleSetId: "supervised",
        rules: [
          rule("comments", 1, { toolNames: ["jira_manage_comment"] }, "allow"),
          rule("mixed", 2, { toolNames: ["jira_get_issue", "read"] }, "allow"),
          rule(
            "by-argument",
            3,
            {
              toolNames: ["jira_update_issue"],
              arguments: [
                { path: "args.issue_key", operator: "glob", value: "APP-*" },
              ],
            },
            "allow",
          ),
          rule("boards", 4, { toolNames: ["jira_get_board"] }, "allow"),
          rule("images", 5, { toolGroups: ["imageGeneration"] }, "deny"),
          rule("other", 6, { toolNames: ["bash"] }, "prompt"),
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
  const rules = migrated.value.overlays[0].rules;
  const byId = Object.fromEntries(rules.map((r) => [r.id, r]));
  assert.deepEqual(byId.comments.when, {
    toolNames: ["quick_script"],
    primaryArgument: {
      operator: "in",
      value: [
        "jira.comments.add",
        "jira.comments.update",
        "jira.comments.delete",
      ],
    },
  });
  assert.deepEqual(byId.mixed.when.toolNames, ["read"]);
  assert.deepEqual(byId["mixed-quick-script"].when.toolNames, ["quick_script"]);
  assert.equal(byId["mixed-quick-script"].decision, "allow");
  assert.equal(byId["by-argument"].enabled, false);
  assert.equal(byId.boards.enabled, false);
  assert.deepEqual(byId.images.when.toolGroups, ["imagegen"]);
  assert.deepEqual(byId.other, old.overlays[0].rules[5]);
  assert.equal(
    new Set(rules.map((r) => `${r.enforcement}:${r.priority}`)).size,
    rules.length,
  );
  const notice = f.service
    .health("p")
    .issues.find((issue) => issue.type === "permission-overlay");
  assert.match(
    notice?.message ?? "",
    /converted to quick_script operation rules/,
  );
  assert.match(notice?.message ?? "", /by-argument/);
});
