import assert from "node:assert/strict";
import { test } from "node:test";
import {
  convertCapabilities,
  convertHarness,
  convertIntegrations,
  convertProfile,
  defaults,
  oldBuiltins,
  projectToolOverrides,
  frozenCapabilitiesSchema,
  frozenProfileFileSchema,
} from "./phase5-format.js";

void test("harness execution, typed tools and integration selections acquire one canonical authority", () => {
  const accounts = {
    version: 1,
    profiles: {
      atlassian: [
        { id: "atlas", name: "Account", credential: "atlassian:atlas" },
      ],
      tavily: [{ id: "search", name: "Search", credential: "tavily:search" }],
    },
    tools: {
      jira: { enabled: true, profileId: "atlas" },
      confluence: { enabled: false, profileId: "other" },
      web: { tavilyProfileId: "search" },
    },
  };
  const legacy = {
    version: 3,
    defaults: { permissionRuleSetId: "autonomous" },
    execution: {
      shellPath: "/custom/shell",
      pythonExecutablePath: "/custom/python",
    },
    tools: {
      disabled: ["web_fetch", "subagent_prompt"],
      bash: {
        maxTimeoutMs: 19000,
        autoPromotion: { enabled: false, afterMs: 3000 },
      },
      imageExplanation: {
        thinkingLevel: "off",
        model: { provider: "test", modelId: "image" },
      },
      kroki: { url: "https://render.example/" },
    },
  };
  const converted = convertHarness(legacy, accounts);
  frozenCapabilitiesSchema.shape.tools.parse(converted.tools);
  assert.equal(converted.version, 4);
  assert.equal(converted.execution, undefined);
  assert.equal(converted.tools.disabled, undefined);
  assert.equal(
    converted.tools.python_exec.settings.interpreterPath,
    "/custom/python",
  );
  assert.equal(converted.tools.bash.settings.shellPath, "/custom/shell");
  assert.equal(converted.tools.bash.settings.maxTimeoutMs, 19000);
  assert.deepEqual(converted.tools.jira, { enabled: true, profileId: "atlas" });
  assert.equal(converted.tools.confluence.profileId, "other");
  assert.equal(converted.tools.web_search.profileId, "search");
  assert.equal(converted.tools.subagents.enabled, false);
  assert.equal(converted.tools.plan_present.enabled, false);
  assert.deepEqual(convertIntegrations(accounts), {
    version: 2,
    profiles: accounts.profiles,
  });
  assert.deepEqual(
    convertHarness(converted, convertIntegrations(accounts)),
    converted,
  );
  assert.deepEqual(projectToolOverrides(legacy, accounts).tools.python_exec, {
    settings: { interpreterPath: "/custom/python" },
  });
});

void test("capability v3 embeds detached typed settings and retains explicit enablement and skills", () => {
  const value = convertCapabilities({
    schemaVersion: 2,
    tools: {
      plan_mode_present: { enabled: true },
      web_search: { enabled: true, profileId: "search" },
    },
    toolSettings: { explain_image: { thinkingLevel: "high" } },
    skills: { file: { local: false }, nerve: {}, agentBrowser: {} },
  });
  assert.equal(value.schemaVersion, 3);
  assert.equal(value.toolSettings, undefined);
  assert.deepEqual(value.tools.plan_present, {
    enabled: true,
    settings: { approvalProfile: "coding" },
  });
  assert.deepEqual(value.tools.explain_image, {
    settings: { thinkingLevel: "high" },
  });
  assert.equal(value.tools.web_search.profileId, "search");
  assert.deepEqual(convertCapabilities(value), value);
});

void test("profile conversion distinguishes Use settings, lead inheritance, concrete defaults and Locks", () => {
  const coding = convertProfile(
    oldBuiltins.coding,
    defaults,
    {},
    { inheritedCodingPermission: true },
  );
  assert.equal(coding.model, undefined);
  assert.equal(coding.permission, undefined);
  const explore = convertProfile(oldBuiltins.explore, defaults);
  assert.equal(explore.model, "lead");
  assert.equal(explore.thinking, "lead");
  assert.deepEqual(explore.permission, { set: "read_only" });
  const fixed = convertProfile(
    {
      ...oldBuiltins.coding,
      name: "fixed",
      model: { lock: "default" },
      thinking: { lock: "default" },
      permission: { lock: "default" },
      compaction: { lock: "default" },
    },
    {
      ...defaults,
      defaults: {
        model: { provider: "test", modelId: "default" },
        thinkingLevel: "high",
        permissionRuleSetId: "autonomous",
      },
    },
  );
  assert.deepEqual(fixed.model, {
    lock: { provider: "test", modelId: "default" },
  });
  assert.deepEqual(fixed.thinking, { lock: "high" });
  assert.deepEqual(fixed.permission, { lock: "autonomous" });
  assert.deepEqual(fixed.compaction, { lock: defaults.compaction });
  const explicitCoding = convertProfile(oldBuiltins.coding, defaults);
  assert.deepEqual(
    explicitCoding.permission,
    { set: defaults.defaults.permissionRuleSetId },
    "an explicit user override is not discarded with the builtin default",
  );
});

void test("mixed model/thinking modes convert independently; only unresolvable input requires repair", () => {
  const mixed = convertProfile(
    { ...oldBuiltins.developer, thinking: "high" },
    defaults,
  );
  assert.equal(mixed.model, "lead");
  assert.deepEqual(mixed.thinking, { set: "high" });
  const separatelyLocked = convertProfile(
    {
      ...oldBuiltins.developer,
      model: { lock: "test/fixed" },
      thinking: "high",
    },
    defaults,
  );
  assert.deepEqual(separatelyLocked.model, {
    lock: { provider: "test", modelId: "fixed" },
  });
  assert.deepEqual(separatelyLocked.thinking, { set: "high" });
  assert.throws(
    () =>
      convertProfile({ ...oldBuiltins.developer, usableBy: "both" }, defaults),
    /ambiguous/,
  );
  assert.throws(
    () =>
      convertProfile(
        { ...oldBuiltins.coding, model: "default", thinking: "default" },
        defaults,
      ),
    /no concrete default model/,
  );
});

void test("frozen boundary rejects malformed typed tool payloads and byte-oversized instructions", () => {
  const capabilities = (tools: unknown) => ({
    schemaVersion: 3,
    tools,
    skills: { file: {}, nerve: {}, agentBrowser: {} },
  });
  assert.equal(
    frozenCapabilitiesSchema.safeParse(
      capabilities({ explain_image: { settings: {} } }),
    ).success,
    false,
  );
  assert.equal(
    frozenCapabilitiesSchema.safeParse(
      capabilities({ generate_image: { settings: { provider: "unknown" } } }),
    ).success,
    false,
  );
  assert.equal(
    frozenCapabilitiesSchema.safeParse(
      capabilities({
        kroki_export: { settings: { url: "file:///tmp/render" } },
      }),
    ).success,
    false,
  );
  assert.equal(
    frozenCapabilitiesSchema.safeParse(
      capabilities({
        bash: {
          settings: {
            maxTimeoutMs: 1,
            autoPromotion: { enabled: true, afterMs: 0 },
          },
        },
      }),
    ).success,
    false,
  );
  const profile = convertProfile(
    oldBuiltins.coding,
    defaults,
    {},
    { inheritedCodingPermission: true },
  );
  assert.equal(
    frozenProfileFileSchema.safeParse({
      ...profile,
      instructions: "é".repeat(8193),
    }).success,
    false,
  );
});
