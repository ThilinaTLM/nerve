import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { createStepContext } from "../../framework/context.js";
import { storagePaths } from "../../../storage-bootstrap/paths.js";
import { convertConversationAgent, extractFromTools } from "./convert.js";
import { builtinExtensions } from "@nervekit/extensions";
import {
  REMOVED_TOOL_OPERATIONS,
  convertRemovedToolException,
} from "./removed-tools.js";
import { EncryptedFileSecretProvider } from "../../../secrets/index.js";
import step from "./step.js";

const findQuickScriptNamespace = (id: string) =>
  builtinExtensions
    .flatMap((extension) => extension.contributes.sdk ?? [])
    .find((namespace) => namespace.id === id);

/** Released `integrations.json`: per-product profiles that name their credential. */
const accounts = {
  version: 2,
  profiles: {
    atlassian: [
      {
        id: "acme",
        name: "Acme",
        siteUrl: "https://acme.atlassian.net",
        email: "a@acme.test",
        defaultProjectKey: "ACME",
        credential: "atlassian:acme",
      },
    ],
    tavily: [{ id: "tav", name: "Tavily", credential: "tavily:tav" }],
  },
};

function home() {
  const root = mkdtempSync(join(tmpdir(), "nerve-0005-"));
  const paths = storagePaths(root);
  const put = (path: string, value: unknown) => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
  };
  const { context } = createStepContext(
    paths,
    step.id,
    step.description,
    () => {},
  );
  const read = (path: string) => JSON.parse(readFileSync(path, "utf8"));
  return { root, paths, put, read, context };
}

void test("quick_script wins over direct tools; differing accounts keep Jira", () => {
  const losses: string[] = [];
  const { tools, entries } = extractFromTools(
    {
      jira: { enabled: true, profileId: "jira-direct" },
      confluence: { enabled: true, profileId: "wiki" },
      web_search: { enabled: true, profileId: "tav-direct" },
      kroki_export: {
        enabled: true,
        settings: { url: "https://kroki.local/" },
      },
      generate_image: {
        enabled: true,
        settings: {
          provider: "openai-codex",
          model: "gpt-image-2.5-sunburst",
          options: { quality: "high", size: "1024x1024", background: "auto" },
        },
      },
      quick_script: {
        enabled: true,
        settings: {
          jira: { enabled: false, profileId: "jira-qs" },
          web: { enabled: true, profileId: "tav-qs" },
        },
      },
      python_exec: { enabled: true },
    },
    (reason) => losses.push(reason),
  );
  assert.deepEqual(entries, {
    atlassian: {
      version: 1,
      enabled: true,
      settings: { account: "jira-qs", jira: false, confluence: true },
    },
    web: {
      version: 1,
      enabled: true,
      settings: { searchAccount: "tav-qs" },
    },
    diagram: { version: 1, settings: { server: "https://kroki.local/" } },
    imagegen: {
      version: 1,
      enabled: true,
      settings: {
        backend: "openai-codex",
        model: "gpt-image-2.5-sunburst",
        quality: "high",
        size: "1024x1024",
        background: "auto",
      },
    },
  });
  assert.equal(losses.length, 1);
  assert.match(losses[0], /different Atlassian accounts/);
  // The removed tools leave their entries; web_search keeps only its switch.
  assert.deepEqual(tools, {
    web_search: { enabled: true },
    quick_script: { enabled: true },
    python_exec: { enabled: true },
  });
});

void test("a child's frozen defaults and overrides become its frozen extension file", () => {
  const { document, entries } = convertConversationAgent(
    {
      schemaVersion: 1,
      revision: 3,
      overrides: { tools: { web_search: { profileId: "tav" } } },
      appliedProfile: {
        name: "explore",
        recommendations: {},
        requirements: { tools: { jira: { enabled: true, profileId: "acme" } } },
      },
      frozenDefaults: {
        tools: {
          jira: { enabled: true, profileId: "acme" },
          kroki_export: {
            enabled: false,
            settings: { url: "https://kroki.io/" },
          },
        },
      },
    },
    () => {},
  );
  assert.deepEqual(entries.atlassian, {
    version: 1,
    enabled: true,
    settings: { account: "acme", jira: true },
  });
  assert.deepEqual(entries.web?.settings, { searchAccount: "tav" });
  // The frozen default server equals the default, so it is not carried.
  assert.equal(entries.diagram, undefined);
  const applied = document.appliedProfile as Record<string, unknown>;
  assert.deepEqual(applied.extensions, {
    requirements: {
      atlassian: {
        version: 1,
        enabled: true,
        settings: { account: "acme", jira: true },
      },
    },
  });
  assert.deepEqual(applied.requirements, {});
});

void test("moves accounts, user, profile and conversation settings, and verifies", async (t) => {
  const { root, paths, put, read, context } = home();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  put(join(paths.configPath, "integrations.json"), accounts);
  const secrets = new EncryptedFileSecretProvider(root);
  await secrets.initialize();
  await secrets.set("provider:atlassian:acme:apiKey", "atl-token");
  await secrets.set("provider:tavily:tav:apiKey", "tvly-key");
  await secrets.set("provider:openai:apiKey", "sk-other");
  put(join(paths.configPath, "agent.json"), {
    schemaVersion: 1,
    revision: 5,
    overrides: {
      model: { provider: "p", modelId: "m" },
      tools: {
        jira: { enabled: true, profileId: "acme" },
        quick_script: {
          enabled: true,
          settings: { jira: { enabled: true, profileId: "acme" } },
        },
      },
    },
  });
  put(join(paths.agentProfilesConfigPath, "planning.json"), {
    schemaVersion: 1,
    name: "planning",
    whenToUse: "x",
    usableBy: "lead",
    instructions: "i",
    requirements: { tools: { web_search: { profileId: "tav" } } },
  });
  put(join(paths.conversationsPath, "conv_1", "config", "agent.json"), {
    schemaVersion: 1,
    revision: 1,
    overrides: { tools: { confluence: { enabled: true, profileId: "acme" } } },
    appliedProfile: null,
  });
  put(join(paths.conversationsPath, "conv_2", "config", "agent.json"), {
    schemaVersion: 1,
    revision: 1,
    overrides: {},
    appliedProfile: null,
  });
  const before = readFileSync(
    join(paths.conversationsPath, "conv_2", "config", "agent.json"),
    "utf8",
  );
  const owned = await step.ownedPaths!(context);
  context.ownPaths(owned);
  await step.run(context);
  await step.verify!(context);

  assert.ok(!existsSync(join(paths.configPath, "integrations.json")));
  assert.deepEqual(read(paths.accountsConfigPath), {
    version: 2,
    accounts: {
      atlassian: [
        {
          id: "acme",
          name: "Acme",
          fields: {
            siteUrl: "https://acme.atlassian.net",
            email: "a@acme.test",
            defaultProjectKey: "ACME",
          },
        },
      ],
      tavily: [{ id: "tav", name: "Tavily", fields: {} }],
    },
  });
  // Account secrets take the `account:<kind>:<id>` id; other secrets stay.
  assert.deepEqual(await new EncryptedFileSecretProvider(root).list(), [
    "provider:account:atlassian:acme:apiKey",
    "provider:account:tavily:tav:apiKey",
    "provider:openai:apiKey",
  ]);
  assert.equal(
    await new EncryptedFileSecretProvider(root).get(
      "provider:account:atlassian:acme:apiKey",
    ),
    "atl-token",
  );
  const agent = read(join(paths.configPath, "agent.json"));
  assert.equal(agent.revision, 5);
  assert.deepEqual(agent.overrides.tools, { quick_script: { enabled: true } });
  assert.deepEqual(read(join(paths.configPath, "extensions.json")), {
    schemaVersion: 1,
    revision: 1,
    extensions: {
      atlassian: {
        version: 1,
        enabled: true,
        settings: { account: "acme", jira: true },
      },
    },
  });
  const profile = read(join(paths.agentProfilesConfigPath, "planning.json"));
  assert.deepEqual(profile.extensions, {
    requirements: {
      web: { version: 1, settings: { searchAccount: "tav" } },
    },
  });
  assert.deepEqual(profile.requirements, {});
  assert.deepEqual(
    read(join(paths.conversationsPath, "conv_1", "config", "extensions.json"))
      .extensions,
    {
      atlassian: {
        version: 1,
        enabled: true,
        settings: { account: "acme", confluence: true },
      },
    },
  );
  // Untouched conversations are byte-identical and get no extension file.
  assert.equal(
    readFileSync(
      join(paths.conversationsPath, "conv_2", "config", "agent.json"),
      "utf8",
    ),
    before,
  );
  assert.ok(
    !existsSync(
      join(paths.conversationsPath, "conv_2", "config", "extensions.json"),
    ),
  );
  // Running again changes nothing.
  const snapshot = readFileSync(
    join(paths.configPath, "extensions.json"),
    "utf8",
  );
  await step.run(context);
  assert.equal(
    readFileSync(join(paths.configPath, "extensions.json"), "utf8"),
    snapshot,
  );
});

void test("an existing accounts file is never replaced, only reshaped", async (t) => {
  const { root, paths, put, context } = home();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  put(join(paths.configPath, "integrations.json"), accounts);
  put(paths.accountsConfigPath, {
    ...accounts,
    profiles: { atlassian: [], tavily: [] },
  });
  context.ownPaths(await step.ownedPaths!(context));
  await step.run(context);
  assert.ok(existsSync(join(paths.configPath, "integrations.json")));
  assert.deepEqual(
    JSON.parse(readFileSync(paths.accountsConfigPath, "utf8")).accounts,
    { atlassian: [], tavily: [] },
  );
});

const permissionRule = (
  id: string,
  priority: number,
  when: object,
  decision = "allow",
) => ({
  id,
  enabled: true,
  priority,
  enforcement: "overridable",
  when,
  decision,
});

void test("permission rules and rule sets naming removed tools are rewritten; what cannot be is disabled and reported", async (t) => {
  const { root, paths, put, read, context } = home();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const rules = [
    permissionRule("create", 1, { toolNames: ["jira_create_issue"] }),
    permissionRule("pages", 2, {
      toolNames: ["confluence_get_page", "confluence_search_pages"],
      toolGroups: ["confluence"],
    }),
    permissionRule("kroki", 3, { toolNames: ["kroki_export"] }, "prompt"),
    permissionRule("img", 4, { toolNames: ["generate_image"] }, "deny"),
    permissionRule("restrict-allow", 5, {
      toolNames: ["confluence_manage_restriction"],
    }),
    permissionRule(
      "restrict-deny",
      6,
      { toolNames: ["confluence_manage_restriction"] },
      "deny",
    ),
    permissionRule("by-key", 7, {
      toolNames: ["jira_update_issue"],
      primaryArgument: { operator: "glob", value: "APP-*" },
    }),
    permissionRule("bash", 8, { toolNames: ["bash"] }, "prompt"),
  ];
  put(paths.permissionsConfigPath, {
    schemaVersion: 2,
    overlays: [{ ruleSetId: "supervised", rules }],
  });
  put(join(paths.conversationsPath, "conv_1", "config", "permissions.json"), {
    schemaVersion: 2,
    overlays: [{ ruleSetId: "supervised", rules: [rules[0]] }],
  });
  put(join(paths.configPath, "rule-sets", "mine.json"), {
    schemaVersion: 1,
    id: "mine",
    name: "Mine",
    source: "user",
    enabled: true,
    rules: [rules[0]],
  });
  const losses: string[] = [];
  const ctx = { ...context, loss: (reason: string) => losses.push(reason) };
  context.ownPaths(await step.ownedPaths!(context));
  await step.run(ctx);
  await step.verify!(context);

  const converted = read(paths.permissionsConfigPath).overlays[0].rules;
  const byId = Object.fromEntries(
    converted.map((rule: { id: string }) => [rule.id, rule]),
  );
  assert.deepEqual(byId.create.when, {
    toolNames: ["quick_script"],
    primaryArgument: { operator: "glob", value: "jira.issues.create" },
  });
  assert.deepEqual(byId.pages.when.toolGroups, ["confluence"]);
  assert.deepEqual(byId.pages.when.primaryArgument.value, [
    "confluence.pages.get",
    "confluence.comments.list",
    "confluence.attachments.list",
    "confluence.pages.search",
  ]);
  assert.equal(byId.kroki.when.primaryArgument.value, "diagram.render");
  assert.equal(byId.kroki.decision, "prompt");
  assert.equal(byId.img.when.primaryArgument.value, "imagegen.generate");
  // Allow cannot widen to raw requests; deny and prompt do cover them.
  assert.equal(byId["restrict-allow"].enabled, false);
  assert.equal(byId["restrict-deny"].enabled, true);
  assert.equal(
    byId["restrict-deny"].when.primaryArgument.value,
    "confluence.request",
  );
  assert.equal(byId["by-key"].enabled, false);
  assert.deepEqual(byId["by-key"].when.toolNames, ["jira_update_issue"]);
  assert.deepEqual(byId.bash, rules[7]);
  assert.equal(
    read(join(paths.conversationsPath, "conv_1", "config", "permissions.json"))
      .overlays[0].rules[0].when.toolNames[0],
    "quick_script",
  );
  assert.equal(
    read(join(paths.configPath, "rule-sets", "mine.json")).rules[0].when
      .toolNames[0],
    "quick_script",
  );
  assert.equal(losses.length, 2);
  assert.match(losses.join("\n"), /restrict-allow/);
  assert.match(losses.join("\n"), /by-key/);
  // A second run has nothing left to convert.
  const snapshot = readFileSync(paths.permissionsConfigPath, "utf8");
  await step.run(ctx);
  assert.equal(readFileSync(paths.permissionsConfigPath, "utf8"), snapshot);
});

void test("the removed-tool table names real SDK methods for every removed tool", () => {
  assert.equal(Object.keys(REMOVED_TOOL_OPERATIONS).length, 30);
  for (const [tool, route] of Object.entries(REMOVED_TOOL_OPERATIONS)) {
    assert.ok(route.operations.length > 0 || route.raw, tool);
    for (const operation of [
      ...route.operations,
      ...(route.raw ? [`${route.raw}.request`] : []),
    ]) {
      const [namespace, ...path] = operation.split(".");
      const methods = findQuickScriptNamespace(namespace)?.methods ?? [];
      assert.ok(
        methods.some((method) => method.path === path.join(".")),
        `${tool} -> ${operation}`,
      );
    }
  }
});

void test("exceptions naming removed tools become quick_script operation globs", () => {
  const exception = (tool: string, effect = "allow") => ({
    id: "exception_1",
    tool,
    effect,
    rule: "*",
  });
  assert.deepEqual(
    convertRemovedToolException(exception("jira_manage_comment")),
    [
      {
        id: "exception_1",
        tool: "quick_script",
        effect: "allow",
        rule: "jira.comments.*",
      },
    ],
  );
  assert.deepEqual(convertRemovedToolException(exception("kroki_export")), [
    {
      id: "exception_1",
      tool: "quick_script",
      effect: "allow",
      rule: "diagram.render",
    },
  ]);
  assert.equal(
    convertRemovedToolException(exception("confluence_manage_restriction")),
    null,
  );
  assert.deepEqual(
    convertRemovedToolException(
      exception("confluence_manage_restriction", "deny"),
    ),
    [
      {
        id: "exception_1",
        tool: "quick_script",
        effect: "deny",
        rule: "confluence.request",
      },
    ],
  );
  assert.deepEqual(convertRemovedToolException(exception("bash")), [
    exception("bash"),
  ]);
});
