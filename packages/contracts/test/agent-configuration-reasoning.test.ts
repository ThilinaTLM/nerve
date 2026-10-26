import assert from "node:assert/strict";
import { test } from "node:test";
import {
  freezeChildPreferences,
  resolveAgentConfiguration,
  type ResolutionOptions,
} from "../src/domains/agent-configuration/resolver.js";
import type {
  AppliedProfile,
  LeadSettingsOverrides,
} from "../src/domains/agent-configuration/schemas.js";

const model = { provider: "test", modelId: "no-reasoning" };
const clampThinking = () => "off" as const;
const sources = [
  "user",
  "project",
  "process",
  "recommendation",
  "conversation",
  "requirement",
] as const;
type Source = (typeof sources)[number];
function applied(
  recommendations: LeadSettingsOverrides = {},
  requirements: LeadSettingsOverrides = {},
): AppliedProfile {
  return {
    name: "coding",
    source: "builtin",
    sourceDigest: "a".repeat(64),
    instructions: "",
    recommendations,
    requirements,
  };
}
function layered(
  modelSource: Source,
  reasoningSource: Source,
): ResolutionOptions {
  const values: Record<Source, LeadSettingsOverrides> = {
    user: {},
    project: {},
    process: {},
    recommendation: {},
    conversation: {},
    requirement: {},
  };
  values[modelSource].model = model;
  values[reasoningSource].reasoningLevel = "high";
  return {
    role: "lead",
    user: values.user,
    project: values.project,
    process: values.process,
    conversation: values.conversation,
    appliedProfile: applied(values.recommendation, values.requirement),
    clampThinking,
  };
}
function assertReasoning(options: ResolutionOptions, blocked: boolean): void {
  const before = JSON.stringify(options);
  const result = resolveAgentConfiguration(options);
  assert.equal(result.settings.reasoningLevel, blocked ? "high" : "off");
  assert.deepEqual(result.diagnostics, [
    {
      code: blocked ? "unsupported-reasoning" : "reasoning-adjusted",
      pointer: "/reasoningLevel",
    },
  ]);
  assert.equal(
    result.provenance["/reasoningLevel"].adjusted,
    blocked ? undefined : true,
  );
  assert.equal(
    JSON.stringify(options),
    before,
    "Resolution must not rewrite authored choices",
  );
}

void test("D7: every lead source pair fits only cross-layer non-required reasoning", () => {
  for (const modelSource of sources)
    for (const reasoningSource of sources) {
      const options = layered(modelSource, reasoningSource);
      const result = resolveAgentConfiguration(options);
      assert.equal(result.provenance["/model"].source, modelSource);
      assert.equal(
        result.provenance["/reasoningLevel"].source,
        reasoningSource,
      );
      assertReasoning(
        options,
        reasoningSource === "requirement" || modelSource === reasoningSource,
      );
    }
});

void test("D7: launch choices fit across layers, but never within the launch pair or for required reasoning", () => {
  for (const source of sources.filter((source) => source !== "conversation")) {
    const launchedReasoning = layered(source, "conversation");
    delete launchedReasoning.conversation;
    assertReasoning(
      {
        ...launchedReasoning,
        role: "child",
        launch: { reasoningLevel: "high" },
      },
      false,
    );
    const launchedModel = layered("conversation", source);
    delete launchedModel.conversation;
    assertReasoning(
      { ...launchedModel, role: "child", launch: { model } },
      source === "requirement",
    );
  }
  assertReasoning(
    { role: "child", launch: { model, reasoningLevel: "high" }, clampThinking },
    true,
  );
});

void test("D7: built-in reasoning fits a model from another source", () => {
  const result = resolveAgentConfiguration({
    role: "lead",
    project: { model },
    clampThinking: () => "low",
  });
  assert.equal(result.settings.reasoningLevel, "low");
  assert.deepEqual(result.provenance["/reasoningLevel"], {
    source: "builtin",
    adjusted: true,
  });
  assert.deepEqual(result.diagnostics, [
    { code: "reasoning-adjusted", pointer: "/reasoningLevel" },
  ]);
});

void test("D7: frozen child preferences store fitted launch values, unchanged on follow-up", () => {
  const user = { model };
  const launch = { reasoningLevel: "high" as const };
  const frozenDefaults = freezeChildPreferences({
    user,
    launch,
    clampThinking,
  });
  assert.equal(frozenDefaults.reasoningLevel, "off");
  assert.equal(launch.reasoningLevel, "high");
  assert.deepEqual(user.model, model);
  const result = resolveAgentConfiguration({
    role: "child",
    frozenDefaults,
    user: { reasoningLevel: "high" },
    clampThinking,
  });
  assert.equal(result.settings.reasoningLevel, "off");
  assert.deepEqual(result.provenance["/reasoningLevel"], { source: "frozen" });
  assert.deepEqual(result.diagnostics, []);
});

void test("D7: a required model can fit frozen reasoning, while unsupported frozen pairs and required reasoning block", () => {
  const frozenDefaults = freezeChildPreferences({
    launch: {
      model: { provider: "test", modelId: "supports-high" },
      reasoningLevel: "high",
    },
  });
  assertReasoning(
    {
      role: "child",
      frozenDefaults,
      appliedProfile: applied({}, { model }),
      clampThinking,
    },
    false,
  );
  assertReasoning({ role: "child", frozenDefaults, clampThinking }, true);
  assertReasoning(
    {
      role: "child",
      frozenDefaults,
      appliedProfile: applied({}, { reasoningLevel: "high" }),
      clampThinking,
    },
    true,
  );
  assert.equal(frozenDefaults.reasoningLevel, "high");
  assert.throws(
    () =>
      freezeChildPreferences({
        launch: { model, reasoningLevel: "high" },
        clampThinking,
      }),
    /Unsupported child launch reasoning/,
  );
});

void test("supported reasoning is left unchanged even when it is required", () => {
  const result = resolveAgentConfiguration({
    role: "lead",
    user: { model },
    appliedProfile: applied({}, { reasoningLevel: "off" }),
    clampThinking,
  });
  assert.equal(result.settings.reasoningLevel, "off");
  assert.deepEqual(result.provenance["/reasoningLevel"], {
    source: "requirement",
    profile: "coding",
  });
  assert.deepEqual(result.diagnostics, []);
});
