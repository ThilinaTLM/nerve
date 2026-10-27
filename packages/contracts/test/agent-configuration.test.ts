import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { z } from "zod";
import { conversationSummarySchema } from "../src/domains/core/conversation.js";
import {
  agentPreferencesSchema,
  leadSettingsOverridesSchema,
  childSettingsOverridesSchema,
  profileDefinitionSchema,
  leadConversationAgentSchema,
  completeChildSettingsSchema,
  configurationJSONSchemas,
  requirementOverlaps,
  childConversationAgentSchema,
  conversationAgentSummariesSchema,
  conversationDefaultsSchema,
} from "../src/domains/agent-configuration/schemas.js";
import {
  resolveAgentConfiguration,
  freezeChildPreferences,
  applySettingsMutation,
} from "../src/domains/agent-configuration/resolver.js";
import type {
  AppliedProfile,
  LeadSettingsOverrides,
} from "../src/domains/agent-configuration/schemas.js";
const A = { provider: "p", modelId: "a" },
  B = { provider: "q", modelId: "b" };
const profile = (
  recommendations: LeadSettingsOverrides = {},
  requirements: LeadSettingsOverrides = {},
): AppliedProfile => ({
  name: "coding",
  source: "builtin",
  sourceDigest: "a".repeat(64),
  instructions: "",
  recommendations,
  requirements,
});
const mutation = (
  changes: LeadSettingsOverrides = {},
  resets: string[] = [],
) => ({
  expectedRevision: 0,
  expectedDigest: "missing" as const,
  changes,
  resets,
});

test("authored subagent defaults resolve below scopes and only active requirements lock", () => {
  const defaults = { explore: false, coding: true };
  const options = {
    role: "lead" as const,
    subagentDefaults: defaults,
  };
  const builtin = resolveAgentConfiguration(options);
  assert.deepEqual(builtin.settings.subagents, {
    explore: { enabled: false },
    coding: { enabled: true },
  });
  assert.deepEqual(builtin.provenance["/subagents/explore/enabled"], {
    source: "builtin",
  });
  for (const scope of ["user", "project"] as const) {
    const scoped = {
      ...options,
      [scope]: { subagents: { coding: { enabled: false } } },
    };
    assert.equal(
      resolveAgentConfiguration(scoped).settings.subagents?.coding?.enabled,
      false,
    );
    const conversation = {
      ...scoped,
      conversation: { subagents: { coding: { enabled: true } } },
    };
    for (const appliedProfile of [
      null,
      profile({ subagents: { coding: { enabled: false } } }),
    ]) {
      const result = resolveAgentConfiguration({
        ...conversation,
        appliedProfile,
      });
      assert.equal(result.settings.subagents?.coding?.enabled, true);
      assert.equal(
        result.provenance["/subagents/coding/enabled"]?.source,
        "conversation",
      );
    }
    const required = profile({}, { subagents: { coding: { enabled: false } } });
    const locked = resolveAgentConfiguration({
      ...conversation,
      appliedProfile: required,
    });
    assert.equal(locked.settings.subagents?.coding?.enabled, false);
    assert.equal(
      locked.provenance["/subagents/coding/enabled"]?.source,
      "requirement",
    );
    assert.throws(
      () =>
        applySettingsMutation(
          {},
          mutation(conversation.conversation),
          required.requirements,
        ),
      /Required/,
    );
    // Switching away from Required reveals the retained conversation choice.
    assert.equal(
      resolveAgentConfiguration({ ...conversation, appliedProfile: profile() })
        .settings.subagents?.coding?.enabled,
      true,
    );
  }
  const recommended = resolveAgentConfiguration({
    ...options,
    user: { subagents: { explore: { enabled: true } } },
    appliedProfile: profile({ subagents: { explore: { enabled: false } } }),
  });
  assert.equal(recommended.settings.subagents?.explore?.enabled, false);
  assert.equal(
    recommended.provenance["/subagents/explore/enabled"]?.source,
    "recommendation",
  );
  const child = resolveAgentConfiguration({ ...options, role: "child" });
  assert.equal(child.settings.subagents, undefined);
  assert.equal(child.provenance["/subagents/explore/enabled"], undefined);
  assert.deepEqual(defaults, { explore: false, coding: true });
});

test("resetting reactive overrides uses a detached validated copy", () => {
  const original: LeadSettingsOverrides = {
    subagents: {
      "ui-developer": { enabled: false },
      explore: { enabled: true },
    },
  };
  const current = new Proxy(original, {
    get(target, key, receiver) {
      const value = Reflect.get(target, key, receiver);
      return value && typeof value === "object" ? new Proxy(value, {}) : value;
    },
  });
  const result = applySettingsMutation(
    current,
    mutation({}, ["/overrides/subagents/ui-developer"]),
  );
  assert.deepEqual(result, { subagents: { explore: { enabled: true } } });
  assert.equal(original.subagents?.["ui-developer"]?.enabled, false);
  result.subagents!.explore!.enabled = false;
  assert.equal(original.subagents?.explore?.enabled, true);
});

test("configuration fixtures parse without materializing fields", () => {
  for (const name of [
    "user-agent",
    "project-agent",
    "conversation-agent",
    "planning-profile",
  ]) {
    const input = JSON.parse(
      readFileSync(
        new URL(`./fixtures/agent-configuration/${name}.json`, import.meta.url),
        "utf8",
      ),
    );
    const schema =
      name === "planning-profile"
        ? profileDefinitionSchema
        : name === "conversation-agent"
          ? leadConversationAgentSchema
          : agentPreferencesSchema;
    assert.deepEqual(schema.parse(input), input);
  }
});
test("strict sparse inputs reject unsupported, partial atomic and future values", () => {
  assert.deepEqual(leadSettingsOverridesSchema.parse({}), {});
  const invalid = [
    { model: { provider: "p" } },
    { model: { ...A, extra: true } },
    { unknown: true },
    { compaction: { customKeepRecentPercent: 10 } },
    { tools: { web_fetch: {} } },
    { tools: { bash: { enabled: false } } },
    { tools: { generate_image: { settings: { provider: "openai-codex" } } } },
    { tools: { bash: { settings: { autoPromotion: { enabled: false } } } } },
  ];
  for (const input of invalid)
    assert.equal(
      leadSettingsOverridesSchema.safeParse(input).success,
      false,
      JSON.stringify(input),
    );
  assert.equal(
    agentPreferencesSchema.safeParse({
      schemaVersion: 2,
      revision: 0,
      overrides: {},
    }).success,
    false,
  );
  assert.equal(
    childSettingsOverridesSchema.safeParse({
      tools: { plan_present: { enabled: false } },
    }).success,
    false,
  );
  assert.equal(
    profileDefinitionSchema.safeParse({
      schemaVersion: 1,
      name: "both",
      description: "both",
      instructions: "",
      usableBy: "both",
      requirements: { subagents: { coding: { enabled: true } } },
    }).success,
    false,
  );
  assert.equal(completeChildSettingsSchema.safeParse({}).success, false);
});
test("mutations reject atomic descent, overlapping operations, unknown fields and locked edits", () => {
  const current = { model: A };
  assert.throws(() =>
    applySettingsMutation(current, mutation({}, ["/overrides/model/provider"])),
  );
  assert.throws(() =>
    applySettingsMutation(
      current,
      mutation({ model: B }, ["/overrides/model"]),
    ),
  );
  assert.throws(() =>
    applySettingsMutation(current, mutation({}, ["/overrides/unknown"])),
  );
  assert.throws(() =>
    applySettingsMutation(current, mutation({ model: B }), { model: A }),
  );
});
test("precedence, atomic model and temporary requirements", () => {
  const options = {
    role: "lead" as const,
    user: { model: A },
    project: { reasoningLevel: "low" as const },
    process: { reasoningLevel: "medium" as const },
    conversation: { model: B },
    appliedProfile: profile({ reasoningLevel: "high" }, { model: A }),
  };
  const result = resolveAgentConfiguration(options);
  assert.deepEqual(result.settings.model, A);
  assert.deepEqual(result.provenance["/model"], {
    source: "requirement",
    profile: "coding",
  });
  assert.equal(result.settings.reasoningLevel, "high");
  assert.deepEqual(
    resolveAgentConfiguration({ ...options, appliedProfile: null }).settings
      .model,
    B,
  );
});
test("source defaults participate at layer priority; same-section named exception wins", () => {
  assert.deepEqual(
    requirementOverlaps(
      { skills: { file: { one: true } } },
      { skills: { defaults: { file: false } } },
    ),
    ["/skills/file/one"],
  );
  assert.equal(
    requirementOverlaps(
      { tools: { jira: { profileId: "a" } } },
      { tools: { jira: { enabled: false } } },
    ).length,
    0,
  );
  const result = resolveAgentConfiguration({
    role: "lead",
    user: { skills: { file: { one: true } } },
    conversation: {
      skills: { defaults: { file: false }, file: { two: true } },
    },
    eligibleSkills: { file: ["one", "two", "three"] },
  });
  assert.deepEqual(result.settings.skills?.file, {
    one: false,
    two: true,
    three: false,
  });
});
test("children freeze launch B below requirements, never reapply recommendation A", () => {
  const appliedProfile = profile({ model: A });
  const frozenDefaults = freezeChildPreferences({
    appliedProfile,
    launch: { model: B },
    eligibleSkills: { file: ["existing"] },
  });
  assert.deepEqual(frozenDefaults.model, B);
  const result = resolveAgentConfiguration({
    role: "child",
    frozenDefaults,
    appliedProfile,
    user: { model: A },
    eligibleSkills: { file: ["new"] },
  });
  assert.deepEqual(result.settings.model, B);
  assert.deepEqual(Object.keys(result.settings.skills!.file!), ["existing"]);
  assert.equal(result.provenance["/model"]!.source, "frozen");
  const required = profile({}, { model: A });
  const noModel = freezeChildPreferences({ appliedProfile: required });
  assert.equal(noModel.model, undefined);
  assert.deepEqual(
    resolveAgentConfiguration({
      role: "child",
      frozenDefaults: noModel,
      appliedProfile: required,
    }).settings.model,
    A,
  );
  assert.equal(
    childConversationAgentSchema.safeParse({
      schemaVersion: 1,
      revision: 0,
      overrides: {},
      appliedProfile: required,
      frozenDefaults: noModel,
    }).success,
    true,
  );
});
test("unavailable references are preserved with readiness diagnostics", () => {
  const result = resolveAgentConfiguration({
    role: "lead",
    user: { model: A },
    referenceAvailable: () => false,
  });
  assert.deepEqual(result.settings.model, A);
  assert.ok(result.diagnostics.some((d) => d.code === "missing-reference"));
});
test("editor schemas derive directly from Zod and cache values stay optional", () => {
  const exported = configurationJSONSchemas();
  assert.deepEqual(
    exported.agentPreferences,
    z.toJSONSchema(agentPreferencesSchema, { io: "input" }),
  );
  assert.ok(exported.profileDefinition);
  assert.deepEqual(
    conversationAgentSummariesSchema.parse({
      schemaVersion: 1,
      entries: { conv: { observedDigest: "a".repeat(64) } },
    }).entries.conv,
    { observedDigest: "a".repeat(64) },
  );
  assert.deepEqual(
    conversationSummarySchema
      .pick({
        model: true,
        reasoningLevel: true,
        permissionRuleSetId: true,
        agentProfile: true,
      })
      .parse({}),
    {},
  );
  assert.deepEqual(
    conversationDefaultsSchema.parse({
      schemaVersion: 1,
      revision: 0,
      overrides: {},
    }).overrides,
    {},
  );
});

test("skill identities cannot resolve inherited object properties", () => {
  const result = resolveAgentConfiguration({
    role: "lead",
    eligibleSkills: { file: ["constructor", "toString", "__proto__"] },
  });
  for (const name of ["constructor", "toString", "__proto__"])
    assert.equal(result.settings.skills!.file![name], true);
  assert.throws(() =>
    applySettingsMutation({}, mutation({}, ["/overrides/constructor"])),
  );
});
