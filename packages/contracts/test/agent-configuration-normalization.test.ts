import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeCreationPreferencesOverrides,
  normalizeSettingsOverrides,
  resolveInheritedConversationSettings,
} from "../src/domains/agent-configuration/normalization.js";
import {
  resolveAgentConfiguration,
  freezeChildPreferences,
  type ResolutionOptions,
} from "../src/domains/agent-configuration/resolver.js";
import type { LeadSettingsOverrides } from "../src/domains/agent-configuration/schemas.js";

const model = { provider: "provider-a", modelId: "model-a" };

test("subagent inheritance normalizes equal true and false against authored defaults and scoped layers", () => {
  for (const enabled of [true, false]) {
    const options: ResolutionOptions = {
      role: "lead",
      subagentDefaults: { explore: enabled },
    };
    const choice = { subagents: { explore: { enabled } } };
    assert.deepEqual(
      normalizeSettingsOverrides(
        choice,
        resolveAgentConfiguration(options).settings,
      ),
      {},
    );
    const scoped = {
      ...options,
      user: { subagents: { explore: { enabled: !enabled } } },
    };
    assert.deepEqual(
      normalizeSettingsOverrides(
        choice,
        resolveAgentConfiguration(scoped).settings,
      ),
      choice,
    );
    const appliedProfile = {
      name: "coding",
      source: "builtin" as const,
      sourceDigest: "a".repeat(64),
      instructions: "",
      recommendations: {},
      requirements: { subagents: { explore: { enabled: !enabled } } },
    };
    const inherited = resolveInheritedConversationSettings({
      ...options,
      conversation: choice,
      appliedProfile,
    });
    assert.equal(inherited.subagents?.explore?.enabled, enabled);
    assert.deepEqual(normalizeSettingsOverrides(choice, inherited), {});
    const recommended = resolveInheritedConversationSettings({
      ...scoped,
      conversation: { subagents: { explore: { enabled: !enabled } } },
      appliedProfile: {
        ...appliedProfile,
        recommendations: choice,
        requirements: {},
      },
    });
    assert.deepEqual(normalizeSettingsOverrides(choice, recommended), {});
  }
});

test("conversation inheritance keeps recommendations but excludes choices and requirements without mutation", () => {
  const options: ResolutionOptions = {
    role: "lead",
    user: { model, permissionRuleSetId: "autonomous" },
    process: { retry: { maxRetries: 2 } },
    conversation: {
      model: { ...model, modelId: "conversation" },
      retry: { maxRetries: 8 },
    },
    appliedProfile: {
      name: "coding",
      source: "builtin",
      sourceDigest: "a".repeat(64),
      instructions: "",
      recommendations: { model: { ...model, modelId: "recommended" } },
      requirements: { permissionRuleSetId: "planning" },
    },
  };
  const original = structuredClone(options);
  const inherited = resolveInheritedConversationSettings(options);
  assert.deepEqual(
    inherited.model,
    options.appliedProfile!.recommendations.model,
  );
  assert.equal(inherited.permissionRuleSetId, "autonomous");
  assert.equal(inherited.retry?.maxRetries, 2);
  assert.deepEqual(options, original);
});

test("child launch choices are excluded from the inherited lower baseline", () => {
  const options: ResolutionOptions = {
    role: "child",
    user: { model, reasoningLevel: "low" },
    launch: { model: { ...model, modelId: "launch" }, reasoningLevel: "high" },
  };
  const original = structuredClone(options);
  const inherited = resolveInheritedConversationSettings(options);
  assert.deepEqual(inherited.model, model);
  assert.equal(inherited.reasoningLevel, "low");
  assert.deepEqual(options, original);
});

test("child conversation inheritance uses frozen settings and captured skill identities, not live layers", () => {
  const frozenDefaults = freezeChildPreferences({
    user: { model, permissionRuleSetId: "autonomous" },
    eligibleSkills: { file: ["captured"] },
  });
  const options: ResolutionOptions = {
    role: "child",
    frozenDefaults,
    user: { model: { ...model, modelId: "live" } },
    conversation: { model: { ...model, modelId: "conversation" } },
    appliedProfile: {
      name: "coding",
      source: "builtin",
      sourceDigest: "a".repeat(64),
      instructions: "",
      recommendations: { model: { ...model, modelId: "recommended" } },
      requirements: { permissionRuleSetId: "planning" },
    },
    eligibleSkills: { file: ["new"] },
  };
  const original = structuredClone(options);
  assert.deepEqual(
    resolveInheritedConversationSettings(options),
    frozenDefaults,
  );
  assert.deepEqual(options, original);
});

test("equal settings are removed across configuration domains without mutation", () => {
  const inherited: LeadSettingsOverrides = {
    model,
    reasoningLevel: "low",
    permissionRuleSetId: "planning",
    compaction: { auto: true, profile: "balanced", customTriggerPercent: 70 },
    retry: { enabled: true, maxRetries: 3, baseDelayMs: 1000 },
    tools: {
      python_exec: {
        enabled: true,
        settings: { interpreterPath: "/bin/python" },
      },
      jira: { enabled: true, profileId: "account" },
      explain_image: { settings: { model } },
      plan_present: { settings: { approvalProfile: "planning" } },
      subagents: { enabled: true },
    },
    subagents: { coding: { enabled: true, model, reasoningLevel: "low" } },
  };
  const original = structuredClone(inherited);
  assert.deepEqual(normalizeSettingsOverrides(inherited, inherited), {});
  assert.deepEqual(inherited, original);
  assert.deepEqual(
    normalizeSettingsOverrides(
      {
        ...inherited,
        retry: { maxRetries: 0 },
        subagents: { coding: { enabled: false } },
      },
      inherited,
    ),
    { retry: { maxRetries: 0 }, subagents: { coding: { enabled: false } } },
  );
});

test("canonical object merge units stay whole and ignore property order", () => {
  const inherited: LeadSettingsOverrides = {
    model,
    tools: {
      bash: { settings: { autoPromotion: { enabled: true, afterMs: 3000 } } },
      generate_image: {
        settings: {
          provider: "openai-codex",
          model: "gpt-image-2.5-flare",
          options: { quality: "low", size: "auto", background: "opaque" },
        },
      },
    },
  };
  const current = structuredClone(inherited);
  current.model = { modelId: model.modelId, provider: model.provider };
  assert.deepEqual(normalizeSettingsOverrides(current, inherited), {});
  current.model.modelId = "different";
  current.tools!.generate_image!.settings!.options.quality = "high";
  const sparse = normalizeSettingsOverrides(current, inherited);
  assert.deepEqual(sparse, {
    model: current.model,
    tools: { generate_image: current.tools!.generate_image },
  });
});

test("empty containers disappear, including the valid empty python settings payload", () => {
  assert.deepEqual(
    normalizeSettingsOverrides(
      {
        compaction: {},
        retry: {},
        tools: { python_exec: { settings: {} } },
        skills: { defaults: {}, file: {} },
        subagents: {},
      },
      {},
    ),
    {},
  );
});

test("equal source defaults that mask inherited named exceptions are retained", () => {
  assert.deepEqual(
    normalizeSettingsOverrides(
      { skills: { defaults: { file: false } } },
      { skills: { defaults: { file: false }, file: { special: true } } },
    ),
    { skills: { defaults: { file: false } } },
  );
});

test("named values compare against retained local defaults, not inherited names", () => {
  assert.deepEqual(
    normalizeSettingsOverrides(
      {
        skills: {
          defaults: { file: false },
          file: { special: true, redundant: false },
        },
      },
      {
        skills: {
          defaults: { file: true },
          file: { special: true, redundant: true },
        },
      },
    ),
    { skills: { defaults: { file: false }, file: { special: true } } },
  );
  assert.deepEqual(
    normalizeSettingsOverrides(
      { skills: { file: { unknown: false, "a~/b": true } } },
      { skills: { defaults: { file: false } } },
    ),
    { skills: { file: { "a~/b": true } } },
  );
});

test("skill normalization preserves resolution and is idempotent for every decision combination", () => {
  const decisions = [undefined, false, true];
  for (const source of ["file", "nerve", "agentBrowser"] as const)
    for (const lowerDefault of decisions)
      for (const lowerNamed of decisions)
        for (const upperDefault of decisions)
          for (const upperNamed of decisions) {
            const inherited: LeadSettingsOverrides = {
              skills: {
                defaults: { [source]: lowerDefault },
                [source]:
                  lowerNamed === undefined ? {} : { example: lowerNamed },
              },
            };
            const current: LeadSettingsOverrides = {
              skills: {
                defaults: { [source]: upperDefault },
                [source]:
                  upperNamed === undefined ? {} : { example: upperNamed },
              },
            };
            const sparse = normalizeSettingsOverrides(current, inherited);
            const effective = (conversation: LeadSettingsOverrides) =>
              resolveAgentConfiguration({
                role: "lead",
                user: inherited,
                conversation,
                eligibleSkills: { [source]: ["example", "other"] },
              }).settings.skills?.[source];
            assert.deepEqual(effective(sparse), effective(current));
            assert.deepEqual(
              normalizeSettingsOverrides(sparse, inherited),
              sparse,
            );
          }
});

test("creation preferences compare atomic model selections by membership, ignoring order and duplicates", () => {
  const inherited = {
    defaultAgentProfile: "coding",
    scopedModels: [model, { ...model, modelId: "other" }],
  };
  assert.deepEqual(
    normalizeCreationPreferencesOverrides(inherited, inherited),
    {},
  );
  assert.deepEqual(
    normalizeCreationPreferencesOverrides({ scopedModels: [] }, inherited),
    { scopedModels: [] },
  );
  const reversed = { scopedModels: [...inherited.scopedModels].reverse() };
  assert.deepEqual(
    normalizeCreationPreferencesOverrides(reversed, inherited),
    {},
  );
  assert.deepEqual(
    normalizeCreationPreferencesOverrides(
      { scopedModels: [model, ...reversed.scopedModels, model] },
      inherited,
    ),
    {},
  );
  assert.deepEqual(
    normalizeCreationPreferencesOverrides(inherited, {
      scopedModels: [...inherited.scopedModels, model],
    }),
    { defaultAgentProfile: "coding" },
  );
  assert.deepEqual(
    normalizeCreationPreferencesOverrides({ scopedModels: [model] }, inherited),
    { scopedModels: [model] },
  );
  const added = {
    scopedModels: [
      ...inherited.scopedModels,
      { ...model, provider: "other-provider" },
    ],
  };
  assert.deepEqual(
    normalizeCreationPreferencesOverrides(added, inherited),
    added,
  );
  assert.deepEqual(
    normalizeCreationPreferencesOverrides(
      { defaultAgentProfile: "planning" },
      inherited,
    ),
    { defaultAgentProfile: "planning" },
  );
  assert.deepEqual(
    normalizeCreationPreferencesOverrides({ scopedModels: [] }, {}),
    { scopedModels: [] },
  );
});
