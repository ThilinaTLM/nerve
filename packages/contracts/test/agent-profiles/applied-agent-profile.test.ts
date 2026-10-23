import assert from "node:assert/strict";
import test from "node:test";
import {
  applyAgentProfileTemplate,
  assertAppliedProfileSettingsChange,
  assertAppliedProfileConfigChange,
  type AgentProfileDraft,
  type AgentProfileSettings,
  type ApplyAgentProfileOptions,
} from "../../src/domains/agent-profiles/index.js";
const current: AgentProfileSettings = {
  model: { provider: "test", modelId: "selected" },
  thinking: "high",
  permission: "autonomous",
  compaction: { auto: true, profile: "balanced", customTriggerPercent: 80 },
  tools: {
    web_search: { enabled: true, profileId: "account" },
    python_exec: {
      enabled: false,
      settings: { interpreterPath: "/bin/python" },
    },
  },
  skills: {
    file: { research: true },
    nerve: { planning: true },
    agentBrowser: {},
  },
};
const draft: AgentProfileDraft = {
  name: "template",
  description: "Template",
  usableBy: "both",
  instructions: "Captured",
};
const supported: ApplyAgentProfileOptions = {
  clampThinking: (_model, thinking) => thinking,
};

test("use-settings keeps every current value after prior Set and Lock applications", () => {
  for (const mode of ["set", "lock"] as const) {
    const first = applyAgentProfileTemplate(
      { ...draft, permission: { [mode]: "planning" } },
      current,
      supported,
    );
    const kept = applyAgentProfileTemplate(draft, first.settings, supported);
    assert.deepEqual(kept.settings, first.settings);
    assert.deepEqual(kept.applied.locked, {});
  }
  const thinkingOnly = applyAgentProfileTemplate(
    { ...draft, thinking: { set: "low" } },
    current,
    supported,
  );
  assert.deepEqual(thinkingOnly.settings.model, current.model);
  assert.equal(thinkingOnly.settings.thinking, "low");
});

test("lead mode copies only explicit independent settings and refuses a missing lead context", () => {
  const profile = {
    ...draft,
    model: "lead" as const,
    tools: { web_search: "lead" as const },
    skills: "lead" as const,
  };
  assert.throws(
    () => applyAgentProfileTemplate(profile, current, supported),
    /requires a lead context/,
  );
  const lead: AgentProfileSettings = {
    ...current,
    model: { provider: "lead", modelId: "lead" },
    thinking: "low",
    permission: "read_only",
    tools: { web_search: { enabled: false, profileId: "other" } },
  };
  const applied = applyAgentProfileTemplate(profile, current, {
    ...supported,
    lead,
  });
  assert.deepEqual(applied.settings.model, lead.model);
  assert.equal(applied.settings.thinking, current.thinking);
  assert.deepEqual(applied.settings.tools.web_search, lead.tools.web_search);
  const thinking = applyAgentProfileTemplate(
    { ...draft, thinking: "lead" },
    current,
    { ...supported, lead },
  );
  assert.deepEqual(thinking.settings.model, current.model);
  assert.equal(thinking.settings.thinking, "low");
});

test("settings mode resets fields to application settings, replaces tool payloads, and respects preserved model", () => {
  const profile: AgentProfileDraft = {
    ...draft,
    model: "settings",
    permission: "settings",
    tools: { python_exec: "settings" },
  };
  assert.throws(
    () => applyAgentProfileTemplate(profile, current, supported),
    /requires settings/,
  );
  const settings: AgentProfileSettings = {
    ...current,
    model: { provider: "test", modelId: "default" },
    permission: "default",
    tools: { python_exec: { enabled: false } },
  };
  const applied = applyAgentProfileTemplate(profile, current, {
    ...supported,
    settings,
  });
  assert.deepEqual(applied.settings.model, settings.model);
  assert.equal(applied.settings.permission, "default");
  assert.deepEqual(applied.settings.tools.python_exec, { enabled: false });
  assert.deepEqual(applied.applied.locked, {});
  const preserved = applyAgentProfileTemplate(profile, current, {
    ...supported,
    settings,
    preserveModel: true,
  });
  assert.deepEqual(preserved.settings.model, current.model);
});

test("snapshots capture independent concrete locks and leave the other model control field editable", () => {
  const profile: AgentProfileDraft = {
    ...draft,
    model: { lock: current.model },
    tools: { python_exec: { lock: { enabled: true } } },
    skills: { lock: "none" },
    compaction: { lock: current.compaction },
  };
  const applied = applyAgentProfileTemplate(profile, current, supported);
  assert.deepEqual(applied.applied.locked.tools?.python_exec, {
    enabled: true,
    settings: { interpreterPath: "/bin/python" },
  });
  profile.instructions = "Edited";
  assert.equal(applied.applied.instructions, "Captured");
  assert.doesNotThrow(() =>
    assertAppliedProfileConfigChange(applied.applied, {
      reasoningLevel: "off",
    }),
  );
  assert.throws(
    () =>
      assertAppliedProfileConfigChange(applied.applied, {
        model: { provider: "other", modelId: "other" },
      }),
    /locked by template/,
  );
  const thinkingLock = applyAgentProfileTemplate(
    { ...draft, thinking: { lock: "high" } },
    current,
    supported,
  );
  assert.throws(
    () =>
      assertAppliedProfileConfigChange(thinkingLock.applied, {
        reasoningLevel: "off",
      }),
    /locked by template/,
  );
  assert.doesNotThrow(() =>
    assertAppliedProfileConfigChange(thinkingLock.applied, {
      model: { provider: "other", modelId: "other" },
    }),
  );
  assert.throws(
    () =>
      assertAppliedProfileSettingsChange(applied.applied, {
        tools: { ...applied.settings.tools, python_exec: { enabled: false } },
      }),
    /locked by template/,
  );
  assert.throws(
    () =>
      assertAppliedProfileSettingsChange(applied.applied, {
        skills: current.skills,
      }),
    /locked by template/,
  );
  assert.throws(
    () =>
      assertAppliedProfileSettingsChange(applied.applied, {
        compaction: { ...current.compaction, auto: false },
      }),
    /locked by template/,
  );
  assert.doesNotThrow(() =>
    assertAppliedProfileSettingsChange(applied.applied, applied.settings),
  );
});

test("approval preservation and target Locks apply independently to model and thinking", () => {
  const replacement = { provider: "test", modelId: "profile" };
  const profile: AgentProfileDraft = {
    ...draft,
    model: { set: replacement },
    thinking: { set: "off" },
  };
  const modelOnly = applyAgentProfileTemplate(profile, current, {
    ...supported,
    preserveModel: true,
  });
  assert.deepEqual(modelOnly.settings.model, current.model);
  assert.equal(modelOnly.settings.thinking, "off");
  const thinkingOnly = applyAgentProfileTemplate(profile, current, {
    ...supported,
    preserveThinking: true,
  });
  assert.deepEqual(thinkingOnly.settings.model, replacement);
  assert.equal(thinkingOnly.settings.thinking, "high");
  const both = { ...supported, preserveModel: true, preserveThinking: true };
  assert.deepEqual(
    applyAgentProfileTemplate(
      { ...profile, model: { lock: replacement } },
      current,
      both,
    ).settings.model,
    replacement,
  );
  assert.equal(
    applyAgentProfileTemplate(
      { ...profile, model: { lock: replacement } },
      current,
      both,
    ).settings.thinking,
    "high",
  );
  assert.deepEqual(
    applyAgentProfileTemplate(
      { ...profile, thinking: { lock: "low" } },
      current,
      both,
    ).settings.model,
    current.model,
  );
  assert.equal(
    applyAgentProfileTemplate(
      { ...profile, thinking: { lock: "low" } },
      current,
      both,
    ).settings.thinking,
    "low",
  );
});

test("thinking is clamped against the resulting model after resolution and before Lock capture", () => {
  const clamp: ApplyAgentProfileOptions = {
    clampThinking: (model, thinking) =>
      model.modelId === "no-thinking" ? "off" : thinking,
  };
  const changedModel = applyAgentProfileTemplate(
    { ...draft, model: { set: { provider: "test", modelId: "no-thinking" } } },
    current,
    clamp,
  );
  assert.equal(changedModel.settings.thinking, "off");
  const lockedThinking = applyAgentProfileTemplate(
    { ...draft, thinking: { lock: "high" } },
    { ...current, model: { provider: "test", modelId: "no-thinking" } },
    clamp,
  );
  assert.equal(lockedThinking.settings.thinking, "off");
  assert.equal(lockedThinking.applied.locked.thinking, "off");
});
