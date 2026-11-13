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
import step from "./step.js";

const accounts = {
  version: 2,
  profiles: {
    atlassian: [{ id: "acme", name: "Acme", credential: "atlassian:acme" }],
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
  });
  assert.equal(losses.length, 1);
  assert.match(losses[0], /different Atlassian accounts/);
  assert.deepEqual(tools, {
    jira: { enabled: true },
    confluence: { enabled: true },
    web_search: { enabled: true },
    kroki_export: { enabled: true },
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
  assert.deepEqual(applied.requirements, {
    tools: { jira: { enabled: true } },
  });
});

void test("moves accounts, user, profile and conversation settings, and verifies", async (t) => {
  const { root, paths, put, read, context } = home();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  put(join(paths.configPath, "integrations.json"), accounts);
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
  assert.deepEqual(read(paths.accountsConfigPath), accounts);
  const agent = read(join(paths.configPath, "agent.json"));
  assert.equal(agent.revision, 5);
  assert.deepEqual(agent.overrides.tools, {
    jira: { enabled: true },
    quick_script: { enabled: true },
  });
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

void test("an existing accounts file is never replaced", async (t) => {
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
    JSON.parse(readFileSync(paths.accountsConfigPath, "utf8")).profiles,
    { atlassian: [], tavily: [] },
  );
});
