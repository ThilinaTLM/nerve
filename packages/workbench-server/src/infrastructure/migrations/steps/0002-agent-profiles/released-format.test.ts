import convertedModeProfiles from "./converted-mode-profiles.json" with { type: "json" };
import { profileDefinitionSchema } from "@nervekit/contracts/agent-configuration";
import { bundledAgentProfiles } from "../../../configuration/agent-configuration/builtins/index.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import fixture from "../../../../../test/fixtures/storage/releases/0.37.0/agent-conversion-inputs.json" with { type: "json" };
import {
  convertPreferencesV037,
  splitCatalogV037,
  convertConversationV037,
  modeSnapshot,
  sha256,
  merge,
  type ConversionContext,
  type Data,
} from "./released-format.js";
import { convertEventPayload } from "./documents.js";

const messages: string[] = [];
const ctx: ConversionContext = {
  report: (message) => messages.push(message),
  builtins: Object.fromEntries(
    fixture.builtins.map((profile) => [profile.name, profile]),
  ),
  skillSources: {
    local: ["file"],
    planning: ["nerve"],
    core: ["agentBrowser"],
  },
};

await test("released harness folds enabled remember-last, preserves independent choices and detached settings", () => {
  const harness = merge(fixture.harness, {
    defaults: { model: { provider: "old", modelId: "old" } },
    rememberLastSelection: true,
    lastSelection: {
      mode: "planning",
      thinkingLevel: "high",
      permissionRuleSetId: "read_only",
    },
    execution: { pythonExecutablePath: "/python", shellPath: "/shell" },
  });
  const result = convertPreferencesV037(
    { harness, capabilities: fixture.capabilities },
    ctx,
  );
  assert.equal(result.agent.overrides.model, undefined);
  assert.equal(result.agent.overrides.reasoningLevel, "high");
  assert.equal(result.agent.overrides.permissionRuleSetId, "read_only");
  assert.equal(result.creation.overrides.defaultAgentProfile, "planning");
  assert.deepEqual(result.agent.overrides.tools?.web_search, {
    enabled: false,
    profileId: "search",
  });
  assert.equal(
    result.agent.overrides.tools?.python_exec?.settings?.interpreterPath,
    "/python",
  );
  assert.equal(
    result.agent.overrides.tools?.bash?.settings?.shellPath,
    "/shell",
  );
  assert.equal(result.agent.overrides.skills?.agentBrowser?.core, false);
  assert.equal(result.agent.overrides.skills?.nerve?.planning, true);
  assert(messages.some((message) => message.includes("Folded remembered")));
  harness.rememberLastSelection = false;
  assert.deepEqual(
    convertPreferencesV037({ harness }, ctx).agent.overrides.model,
    { provider: "old", modelId: "old" },
  );
});

await test("released sub-agent split removes each parent copy and maps none/inherit/named sources", () => {
  const split = splitCatalogV037(fixture.catalog, "user", ctx);
  assert.equal(split.launches.developer, undefined);
  assert.equal(split.profiles.explore.recommendations.skills, undefined);
  assert.equal(
    split.profiles.explore.whenToUse,
    ctx.builtins.explore.description,
  );
  assert.deepEqual(split.profiles.developer.recommendations.skills, {
    file: { local: false },
    nerve: { planning: true },
    agentBrowser: { core: false },
  });
  assert.equal(split.profiles.developer.recommendations.model, undefined);
  assert.equal(
    split.profiles.developer.recommendations.reasoningLevel,
    undefined,
  );
  assert(messages.some((message) => message.includes("developer.model")));
  assert(messages.some((message) => message.includes("developer.thinking")));
  const inherit = splitCatalogV037(
    {
      schemaVersion: 1,
      profiles: {
        developer: {
          skills: "inherit",
          thinking: "low",
          model: "provider/model/with/slash",
          enabled: false,
        },
      },
    },
    "project",
    ctx,
  );
  assert.equal(inherit.profiles.developer.recommendations.skills, undefined);
  assert.deepEqual(inherit.launches.developer, {
    enabled: false,
    reasoningLevel: "low",
    model: { provider: "provider", modelId: "model/with/slash" },
  });
  const conversation = splitCatalogV037(fixture.catalog, "conversation", ctx);
  assert.deepEqual(conversation.profiles, {});
  assert(
    messages.some((message) =>
      message.includes("Dropped conversation sub-agent fields"),
    ),
  );
});

await test("mode snapshots bind bundled Planning requirements, Coding contributes no settings", () => {
  const planning = modeSnapshot("planning");
  assert.equal(planning.source, "builtin");
  assert.match(planning.sourceDigest, /^[a-f0-9]{64}$/);
  assert.deepEqual(planning.requirements, {
    permissionRuleSetId: "planning",
    tools: { plan_present: { enabled: true } },
  });
  assert.deepEqual(modeSnapshot("coding").requirements, {});
  const document = convertConversationV037(
    fixture.conversation,
    {
      capabilities: fixture.capabilities,
      harness: { compaction: { auto: false } },
      subagents: fixture.catalog,
    },
    ctx,
  );
  assert.equal(document.overrides.permissionRuleSetId, "autonomous");
  assert.equal(document.appliedProfile?.name, "planning");
  assert.equal(fixture.conversation.instructions, "preserved instructions");
});

await test("existing child freezes released choices, projects prohibited tools, never reapplies live profile", () => {
  const base: Data = convertPreferencesV037({ harness: fixture.harness }, ctx)
    .agent.overrides;
  base.tools = merge(
    {
      jira: { enabled: false },
      confluence: { enabled: false },
      python_exec: { settings: {} },
    },
    base.tools,
  );
  base.skills = merge(
    {
      defaults: { file: true, nerve: false, agentBrowser: false },
      file: {},
      nerve: {},
      agentBrowser: {},
    },
    base.skills,
  );
  const child = convertConversationV037(
    fixture.conversation,
    { capabilities: fixture.capabilities, childDefaults: base },
    ctx,
  );
  assert("frozenDefaults" in child);
  assert.deepEqual(child.overrides, {});
  assert.equal(child.appliedProfile, null);
  assert.equal(child.frozenDefaults.permissionRuleSetId, "autonomous");
  assert.equal(child.frozenDefaults.tools.web_search.enabled, false);
  assert.equal("subagents" in child.frozenDefaults.tools, false);
  assert.equal("plan_present" in child.frozenDefaults.tools, false);
  assert.equal(child.frozenDefaults.skills.agentBrowser.core, false);
});

await test("rejects intermediate/future formats, unknown fields, malformed atomic values, incomplete custom profiles", () => {
  for (const harness of [
    { version: 4 },
    { version: 3, surprise: true },
    { version: 3, defaults: { model: { provider: "x" } } },
  ])
    assert.throws(() => convertPreferencesV037({ harness }, ctx));
  assert.throws(() =>
    splitCatalogV037(
      { schemaVersion: 1, profiles: { custom: { skills: "none" } } },
      "user",
      ctx,
    ),
  );
  assert.throws(
    () =>
      splitCatalogV037(
        {
          schemaVersion: 1,
          profiles: { developer: { skills: { undiscovered: false } } },
        },
        "user",
        ctx,
      ),
    /source identity/,
  );
});

await test("integrations accounts and references survive while detached tool selections move", () => {
  const accounts = {
    atlassian: [{ id: "jira", name: "Jira", credential: "secret-reference" }],
    tavily: [],
  };
  const result = convertPreferencesV037(
    {
      integrations: {
        version: 1,
        profiles: accounts,
        tools: {
          jira: { enabled: true, profileId: "jira" },
          confluence: { enabled: false },
          web: { tavilyProfileId: "unavailable" },
        },
      },
    },
    ctx,
  );
  assert.deepEqual(result.integrations, { version: 2, profiles: accounts });
  assert.equal(
    result.agent.overrides.tools?.web_search?.profileId,
    "unavailable",
  );
  const event = {
    toolName: "plan_mode_present",
    content: [
      { type: "toolCall", name: "plan_mode_present" },
      { type: "text", text: "plan_mode_present" },
    ],
  };
  const output = convertEventPayload(event) as typeof event;
  assert.equal(output.toolName, "plan_present");
  assert.equal(output.content[0].name, "plan_present");
  assert.equal(output.content[1].text, "plan_mode_present");
});

await test("D9 reports document and newly inherited fields, while existing children preserve released absence", () => {
  const report: string[] = [];
  const lower: Data = convertPreferencesV037({ harness: fixture.harness }, ctx)
    .agent.overrides;
  lower.tools = merge(
    {
      jira: { enabled: true, profileId: "account-a" },
      confluence: { enabled: false },
      python_exec: { settings: {} },
    },
    lower.tools,
  );
  lower.tools.jira = { enabled: true, profileId: "account-a" };
  lower.tools.explain_image.settings.model = {
    provider: "provider",
    modelId: "image",
  };
  lower.skills = merge(
    {
      defaults: { file: true, nerve: false, agentBrowser: false },
      file: {},
      nerve: {},
      agentBrowser: {},
    },
    lower.skills,
  );
  const own = {
    schemaVersion: 2,
    tools: { jira: { enabled: true } },
    toolSettings: { explain_image: { thinkingLevel: "off" } },
  };
  const context = {
    ...ctx,
    inheritedSettings: lower,
    documentPath: "/project/.nerve/config/capabilities.json",
    report: (message: string) => report.push(message),
  };
  const lead = convertConversationV037(
    fixture.conversation,
    { capabilities: own },
    context,
  );
  assert.equal(lead.overrides.tools?.jira?.profileId, undefined);
  assert.deepEqual(report, [
    "D9 newly inherited account: /project/.nerve/config/capabilities.json /tools/jira/profileId",
    "D9 newly inherited model: /project/.nerve/config/capabilities.json /tools/explain_image/settings/model",
  ]);
  report.length = 0;
  const child = convertConversationV037(
    fixture.conversation,
    { capabilities: own, childDefaults: lower },
    context,
  );
  assert("frozenDefaults" in child);
  assert.equal(child.frozenDefaults.tools.jira.profileId, undefined);
  assert.equal(
    child.frozenDefaults.tools.explain_image.settings.model,
    undefined,
  );
  assert.equal(child.frozenDefaults.tools.jira.enabled, true);
  assert.deepEqual(report, []);
});

await test("authored bundled children use normal choices without profile skill-source defaults", () => {
  const explore = profileDefinitionSchema.parse(
    JSON.parse(bundledAgentProfiles.explore),
  );
  const developer = profileDefinitionSchema.parse(
    JSON.parse(bundledAgentProfiles.developer),
  );
  assert.equal(explore.usableBy, "subagent");
  assert.equal(explore.recommendations?.skills, undefined);
  assert.equal(developer.recommendations?.model, undefined);
  assert.equal(developer.recommendations?.reasoningLevel, undefined);
  assert.equal(
    modeSnapshot("planning").sourceDigest,
    sha256(convertedModeProfiles.planning),
  );
  assert.equal(
    modeSnapshot("coding").sourceDigest,
    sha256(convertedModeProfiles.coding),
  );
});

await test("released sparse project atomics materialize complete values and enablement is only a launch choice", () => {
  const result = convertPreferencesV037(
    {
      scope: "project",
      harness: {
        defaults: { model: { modelId: "project" } },
        tools: {
          imageGeneration: { options: { quality: "low" } },
          bash: { autoPromotion: { enabled: false } },
        },
      },
    },
    {
      ...ctx,
      inheritedSettings: {
        model: { provider: "provider", modelId: "user" },
        tools: {
          bash: {
            settings: { autoPromotion: { enabled: true, afterMs: 1000 } },
          },
        },
      },
    },
  );
  assert.deepEqual(result.agent.overrides.model, {
    provider: "provider",
    modelId: "project",
  });
  assert.deepEqual(
    result.agent.overrides.tools?.bash?.settings?.autoPromotion,
    { enabled: false, afterMs: 1000 },
  );
  assert.equal(
    result.agent.overrides.tools?.generate_image?.settings?.provider,
    "openai-codex",
  );
  const split = splitCatalogV037(
    {
      schemaVersion: 1,
      profiles: { developer: { enabled: false, instructions: "edited" } },
    },
    "user",
    ctx,
  );
  assert.equal(split.launches.developer.enabled, false);
  assert.notEqual(split.profiles.developer.enabled, false);
});

await test("D10 preserves exact SQL prompt context in both lead and child JSON, never in settings", () => {
  const row = {
    ...fixture.conversation,
    instructions: "  exact local instructions\n",
    system_prompt: "",
  };
  const lead = convertConversationV037(row, {}, ctx);
  assert.deepEqual(lead.context, {
    instructions: row.instructions,
    systemPrompt: "",
  });
  assert(!Object.hasOwn(lead.overrides, "instructions"));
  // Use the same validated released defaults used by the existing child fixture.
  const defaults: Data = convertPreferencesV037(
    { harness: fixture.harness },
    ctx,
  ).agent.overrides;
  defaults.tools = merge(
    {
      jira: { enabled: false },
      confluence: { enabled: false },
      python_exec: { settings: {} },
    },
    defaults.tools,
  );
  defaults.skills = merge(
    {
      defaults: { file: true, nerve: true, agentBrowser: true },
      file: {},
      nerve: {},
      agentBrowser: {},
    },
    defaults.skills,
  );
  const child = convertConversationV037(row, { childDefaults: defaults }, ctx);
  assert.deepEqual(child.context, lead.context);
  assert(child.appliedProfile === null);
  assert("frozenDefaults" in child);
  assert(!Object.hasOwn(child.frozenDefaults, "instructions"));
  assert(
    !Object.hasOwn(
      convertConversationV037(
        { ...row, instructions: null, system_prompt: null },
        {},
        ctx,
      ),
      "context",
    ),
  );
});
