import { asyncSubagentToolNames } from "../../src/domains/agents/async-subagents.js";
import assert from "node:assert/strict";
import test from "node:test";
import { defaultSettings } from "../../src/domains/settings/settings.js";
import {
  applyCapabilityPatch,
  capabilityToolSettingsFromSettings,
  capabilityToolsFromDisabledNames,
  disabledToolNamesForCapabilities,
  capabilityPatchSchema,
  capabilityOverridesDocumentSchema,
  emptyCapabilityOverrides,
  resolveCapabilitySelection,
  type CapabilitySelection,
  type CapabilityToolSettings,
} from "../../src/domains/capabilities/capabilities.js";

const toolSettings: CapabilityToolSettings =
  capabilityToolSettingsFromSettings(defaultSettings);

const user: CapabilitySelection = {
  disabledTools: ["python_exec"],
  toolProfiles: {},
  toolSettings,
  disabledFileSkills: ["release"],
  enabledNerveSkills: [],
  enabledAgentBrowserSkills: ["core"],
};

test("capability selection composes user, project, and conversation scopes", () => {
  const project = capabilityOverridesDocumentSchema.parse({
    schemaVersion: 1,
    tools: { python_exec: true, web_search: false },
    skills: {
      file: { release: true, deploy: false },
      nerve: { "skill-creator": true },
      agentBrowser: { core: false, browser: true },
    },
  });
  const conversation = capabilityOverridesDocumentSchema.parse({
    schemaVersion: 1,
    tools: { web_search: true },
    skills: {
      file: { deploy: true },
      nerve: { "skill-creator": false },
      agentBrowser: { browser: false },
    },
  });

  assert.deepEqual(
    resolveCapabilitySelection({ user, project, conversation }),
    {
      disabledTools: [],
      toolProfiles: {},
      toolSettings,
      disabledFileSkills: [],
      enabledNerveSkills: [],
      enabledAgentBrowserSkills: [],
    },
  );
});

test("missing entries inherit and null patches remove an override", () => {
  const document = applyCapabilityPatch(
    emptyCapabilityOverrides(),
    {
      tools: { explore: { enabled: false } },
      skills: {
        file: { release: true },
        nerve: { "skill-creator": true },
      },
    },
    user,
  );
  assert.deepEqual(document.tools.explore, { enabled: false });
  assert.equal(document.skills.file.release, true);
  assert.equal(document.skills.nerve["skill-creator"], true);

  const reset = applyCapabilityPatch(
    document,
    {
      tools: { explore: { enabled: null } },
      skills: {
        file: { release: null },
        nerve: { "skill-creator": null },
      },
    },
    user,
  );
  assert.deepEqual(reset, emptyCapabilityOverrides());
});

test("unknown tool keys are rejected but dormant skill names are retained", () => {
  assert.throws(() =>
    capabilityOverridesDocumentSchema.parse({
      schemaVersion: 1,
      tools: { made_up: true },
    }),
  );
  const parsed = capabilityOverridesDocumentSchema.parse({
    schemaVersion: 1,
    skills: { file: { "not-installed-here": false } },
  });
  assert.equal(parsed.skills.file["not-installed-here"], false);
  assert.deepEqual(parsed.skills.nerve, {});
});

test("async subagents are one capability across settings, overrides, and harness tools", () => {
  const disabledTools = capabilityToolsFromDisabledNames([
    ...asyncSubagentToolNames,
  ]);
  assert.deepEqual(disabledTools, ["subagents"]);
  const project = applyCapabilityPatch(
    emptyCapabilityOverrides(),
    { tools: { subagents: { enabled: true } } },
    { ...user, disabledTools },
  );
  assert.deepEqual(
    resolveCapabilitySelection({ user: { ...user, disabledTools }, project })
      .disabledTools,
    [],
  );
  const conversation = applyCapabilityPatch(
    emptyCapabilityOverrides(),
    { tools: { subagents: { enabled: false } } },
    { ...user, disabledTools: [] },
  );
  const selected = resolveCapabilitySelection({
    user: { ...user, disabledTools },
    project,
    conversation,
  });
  assert.deepEqual(disabledToolNamesForCapabilities(selected.disabledTools), [
    ...asyncSubagentToolNames,
  ]);
  assert.equal(
    capabilityPatchSchema.safeParse({
      tools: { subagent_new: { enabled: true } },
    }).success,
    false,
  );
});

test("legacy individual subagent overrides migrate without partially enabling the group", () => {
  const parse = (tools: Record<string, boolean>) =>
    capabilityOverridesDocumentSchema.parse({ schemaVersion: 1, tools }).tools;
  assert.deepEqual(parse({ subagent_new: true }), {
    subagents: { enabled: false },
  });
  assert.deepEqual(
    parse(
      Object.fromEntries(asyncSubagentToolNames.map((name) => [name, true])),
    ),
    { subagents: { enabled: true } },
  );
  assert.deepEqual(parse({ subagent_new: true, subagent_stop: false }), {
    subagents: { enabled: false },
  });
  assert.deepEqual(parse({ subagent_new: false, subagents: true }), {
    subagents: { enabled: true },
  });
});

test("version 1 documents migrate boolean tool overrides to sparse objects", () => {
  const parsed = capabilityOverridesDocumentSchema.parse({
    schemaVersion: 1,
    tools: { jira: true, web_search: false },
  });
  assert.equal(parsed.schemaVersion, 2);
  assert.deepEqual(parsed.tools, {
    jira: { enabled: true },
    web_search: { enabled: false },
  });
});

test("tool fields inherit independently across levels", () => {
  const project = capabilityOverridesDocumentSchema.parse({
    schemaVersion: 2,
    tools: { jira: { enabled: true } },
  });
  const conversation = capabilityOverridesDocumentSchema.parse({
    schemaVersion: 2,
    tools: { jira: { profileId: "pplied" } },
  });
  const selection = resolveCapabilitySelection({
    user: { ...user, disabledTools: ["jira"], toolProfiles: { jira: "ner" } },
    project,
    conversation,
  });
  assert.equal(selection.disabledTools.includes("jira"), false);
  assert.deepEqual(selection.toolProfiles, { jira: "pplied" });
});

test("profile IDs are only accepted for profiled tools and empty entries are rejected", () => {
  assert.throws(() =>
    capabilityOverridesDocumentSchema.parse({
      schemaVersion: 2,
      tools: { python_exec: { profileId: "x" } },
    }),
  );
  assert.throws(() =>
    capabilityOverridesDocumentSchema.parse({
      schemaVersion: 2,
      tools: { jira: {} },
    }),
  );
});

test("patches equal to the inherited value are pruned field by field", () => {
  const inherited: CapabilitySelection = {
    ...user,
    disabledTools: ["jira"],
    toolProfiles: { jira: "ner" },
  };
  const document = applyCapabilityPatch(
    emptyCapabilityOverrides(),
    { tools: { jira: { enabled: true, profileId: "ner" } } },
    inherited,
  );
  assert.deepEqual(document.tools, { jira: { enabled: true } });

  const back = applyCapabilityPatch(
    document,
    {
      tools: { jira: { enabled: false } },
      skills: { file: { release: false }, agentBrowser: { core: true } },
    },
    inherited,
  );
  assert.deepEqual(back, emptyCapabilityOverrides());
});

test("a stored override survives when the parent later matches it", () => {
  const conversation = applyCapabilityPatch(
    emptyCapabilityOverrides(),
    { tools: { jira: { enabled: true } } },
    { ...user, disabledTools: ["jira"] },
  );
  const parentNowEnabled = { ...user, disabledTools: [] };
  assert.deepEqual(
    resolveCapabilitySelection({ user: parentNowEnabled, conversation })
      .disabledTools,
    [],
  );
  const parentDisabledAgain = { ...user, disabledTools: ["jira" as const] };
  assert.deepEqual(
    resolveCapabilitySelection({ user: parentDisabledAgain, conversation })
      .disabledTools,
    [],
  );
});

test("tool settings replace inherited settings per tool across levels", () => {
  const exploreModel = {
    provider: "openai",
    modelId: "gpt-5.1-mini",
  };
  const project = applyCapabilityPatch(
    emptyCapabilityOverrides(),
    { toolSettings: { kroki_export: { url: "http://127.0.0.1:9080/kroki" } } },
    user,
  );
  // URLs are normalized before storage and before comparison.
  assert.deepEqual(project.toolSettings, {
    kroki_export: { url: "http://127.0.0.1:9080/kroki/" },
  });
  const inherited = resolveCapabilitySelection({ user, project });
  const conversation = applyCapabilityPatch(
    emptyCapabilityOverrides(),
    {
      toolSettings: {
        explore: { model: exploreModel, thinkingLevel: "high" },
        // Equal to the inherited project value, so nothing is stored.
        kroki_export: { url: "http://127.0.0.1:9080/kroki/" },
      },
    },
    inherited,
  );
  assert.deepEqual(conversation.toolSettings, {
    explore: { model: exploreModel, thinkingLevel: "high" },
  });
  const effective = resolveCapabilitySelection({
    user,
    project,
    conversation,
  }).toolSettings;
  assert.deepEqual(effective.explore, {
    model: exploreModel,
    thinkingLevel: "high",
  });
  assert.equal(effective.kroki_export.url, "http://127.0.0.1:9080/kroki/");
  assert.deepEqual(effective.generate_image, toolSettings.generate_image);

  const reset = applyCapabilityPatch(
    conversation,
    { toolSettings: { explore: null } },
    inherited,
  );
  assert.deepEqual(reset, emptyCapabilityOverrides());
});

test("tool settings overrides are validated per tool", () => {
  assert.equal(
    capabilityPatchSchema.safeParse({
      toolSettings: { python_exec: { enabled: true } },
    }).success,
    false,
  );
  assert.throws(() =>
    capabilityOverridesDocumentSchema.parse({
      schemaVersion: 2,
      toolSettings: { kroki_export: { url: "ftp://kroki.example" } },
    }),
  );
  assert.deepEqual(
    capabilityOverridesDocumentSchema.parse({ schemaVersion: 2 }).toolSettings,
    {},
  );
});

test("settings project to tool settings without undefined fields", () => {
  const projected = capabilityToolSettingsFromSettings({
    ...defaultSettings,
    exploreAgent: { model: undefined, thinkingLevel: "low" },
  });
  assert.deepEqual(projected.explore, { thinkingLevel: "low" });
  assert.equal(Object.hasOwn(projected.explore, "model"), false);
});
