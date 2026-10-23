import assert from "node:assert/strict";
import { test } from "node:test";
import {
  saveAgentConfigurationRequestSchema,
  saveAgentConfigurationResultSchema,
  saveCreationPreferencesRequestSchema,
  effectiveAgentViewResultSchema,
  setConversationAgentProfileRequestSchema,
  profileTransitionResultSchema,
  profileConfirmationSchema,
  interactionResolveResultSchema,
} from "../src/domains/agent-configuration/agent-configuration-operations.js";
import {
  interactionResolutionSchema,
  planReviewRequestSchema,
} from "../src/domains/core/tool-call.js";
import {
  createConversationRequestSchema,
  configureConversationRequestSchema,
} from "../src/domains/core/core-operations.js";
import { resolveAgentConfiguration } from "../src/domains/agent-configuration/resolver.js";

const expected = { expectedRevision: 0, expectedDigest: "missing" as const };
const targetProfile = { name: "coding", digest: "a".repeat(64) };
const confirmation = {
  ...expected,
  targetProfile,
  transitionId: "transition-1",
};
const source = {
  scope: { scope: "conversation", conversationId: "c" },
  generation: 1,
  revision: 1,
  digest: "b".repeat(64),
  path: "/home/data/conversations/c/config/agent.json",
};
const effective = {
  status: "available",
  conversationId: "c",
  role: "lead",
  appliedProfile: null,
  resolution: resolveAgentConfiguration({ role: "lead" }),
  diagnostics: [],
  sources: [source],
};

test("scoped saves require CAS tokens and canonical sparse mutations without metadata edits", () => {
  const request = {
    ...expected,
    scope: { scope: "conversation", conversationId: "c" },
    changes: {
      retry: { enabled: false },
      model: { provider: "p", modelId: "m" },
    },
    resets: ["/overrides/reasoningLevel"],
  };
  assert.deepEqual(saveAgentConfigurationRequestSchema.parse(request), request);
  for (const field of ["expectedRevision", "expectedDigest"]) {
    const missing = { ...request } as Record<string, unknown>;
    delete missing[field];
    assert.equal(
      saveAgentConfigurationRequestSchema.safeParse(missing).success,
      false,
    );
  }
  for (const resets of [
    ["/schemaVersion"],
    ["/overrides/model/provider"],
    ["/overrides/tools", "/overrides/tools/jira"],
    ["/overrides/notASetting"],
  ])
    assert.equal(
      saveAgentConfigurationRequestSchema.safeParse({
        ...request,
        changes: {},
        resets,
      }).success,
      false,
    );
  assert.equal(
    saveAgentConfigurationRequestSchema.safeParse({
      ...request,
      resets: ["/overrides/model"],
    }).success,
    false,
  );
  assert.equal(
    saveAgentConfigurationRequestSchema.safeParse({
      ...request,
      appliedProfile: null,
    }).success,
    false,
  );
  assert.equal(
    saveAgentConfigurationRequestSchema.safeParse({
      ...request,
      changes: { model: { provider: "p" } },
    }).success,
    false,
  );
  assert.equal(
    saveAgentConfigurationRequestSchema.safeParse({
      ...request,
      expectedDigest: "stale",
    }).success,
    false,
  );
});

test("creation saves allow only user/project scopes and atomic picker lists", () => {
  const request = {
    ...expected,
    scope: { scope: "project", projectId: "p" },
    changes: { scopedModels: [] },
    resets: ["/overrides/defaultAgentProfile"],
  };
  assert.deepEqual(
    saveCreationPreferencesRequestSchema.parse(request),
    request,
  );
  for (const invalid of [
    { ...request, scope: { scope: "conversation", conversationId: "c" } },
    { ...request, changes: { model: { provider: "p", modelId: "m" } } },
    { ...request, resets: ["/overrides/scopedModels/0"] },
    { ...request, resets: ["/overrides/scopedModels"] },
    {
      ...request,
      resets: [
        "/overrides/defaultAgentProfile",
        "/overrides/defaultAgentProfile",
      ],
    },
  ])
    assert.equal(
      saveCreationPreferencesRequestSchema.safeParse(invalid).success,
      false,
    );
});

test("effective composer views retain missing models, source labels and requirement provenance", () => {
  const result = effectiveAgentViewResultSchema.parse(effective);
  assert.deepEqual(result, effective);
  if (result.status !== "available") throw new Error("expected available");
  assert.equal(result.resolution.settings.model, undefined);
  assert.equal(result.resolution.diagnostics[0]?.code, "model-required");
  const required = {
    ...effective,
    resolution: {
      ...effective.resolution,
      settings: { permissionRuleSetId: "planning" },
      provenance: {
        "/permissionRuleSetId": { source: "requirement", profile: "planning" },
      },
    },
  };
  assert.deepEqual(effectiveAgentViewResultSchema.parse(required), required);
  assert.equal(
    effectiveAgentViewResultSchema.safeParse({
      ...required,
      resolution: {
        ...required.resolution,
        provenance: { "/model": { source: "legacy" } },
      },
    }).success,
    false,
  );
  assert.equal(
    effectiveAgentViewResultSchema.safeParse({
      ...effective,
      executorCapture: {},
    }).success,
    false,
  );
  assert.equal(
    effectiveAgentViewResultSchema.safeParse({
      ...effective,
      resolution: {
        ...effective.resolution,
        provenance: { "/model": { source: "requirement" } },
      },
    }).success,
    false,
  );
  const conflict = {
    status: "conflict",
    current: { revision: 2, digest: "c".repeat(64) },
    diagnostics: [],
  };
  assert.deepEqual(
    saveAgentConfigurationResultSchema.parse(conflict),
    conflict,
  );
  const diagnostic = {
    scope: "user",
    document: "agent",
    path: "/config/agent.json",
    code: "publication-failed",
    pointer: "",
    affectedCapability: "agent-execution",
    recoveryChoices: ["reload"],
  };
  const unavailable = { status: "unavailable", diagnostics: [diagnostic] };
  assert.deepEqual(
    saveAgentConfigurationResultSchema.parse(unavailable),
    unavailable,
  );
  assert.equal(
    saveAgentConfigurationResultSchema.safeParse({
      status: "unavailable",
      diagnostics: [],
    }).success,
    false,
  );
  assert.equal(
    saveAgentConfigurationResultSchema.safeParse({
      ...unavailable,
      overrides: {},
    }).success,
    false,
  );
});

test("profile switch/reapply uses captured target bytes and cannot overwrite conversation choices", () => {
  for (const action of ["switch", "reapply"]) {
    const request = { ...expected, targetProfile, conversationId: "c", action };
    assert.deepEqual(
      setConversationAgentProfileRequestSchema.parse(request),
      request,
    );
    assert.equal(
      setConversationAgentProfileRequestSchema.safeParse({
        ...request,
        transitionId: "obsolete",
      }).success,
      false,
    );
    assert.equal(
      setConversationAgentProfileRequestSchema.safeParse({
        ...request,
        choices: { reasoningLevel: "high" },
      }).success,
      false,
    );
    assert.equal(
      setConversationAgentProfileRequestSchema.safeParse({
        ...request,
        targetProfile: { name: "coding" },
      }).success,
      false,
    );
  }
});

test("plan reviews capture profile digests and approvals preserve omitted choice fields", () => {
  const review = {
    ...expected,
    targetProfile,
    assetId: "asset",
    path: "plan.md",
  };
  assert.deepEqual(planReviewRequestSchema.parse(review), review);
  for (const choices of [
    undefined,
    {},
    { model: { provider: "p", modelId: "m" } },
    { reasoningLevel: "high" },
  ]) {
    const submitted = {
      ...confirmation,
      ...(choices === undefined ? {} : { choices }),
    };
    const approval = {
      kind: "plan_review",
      decision: "approve",
      confirmation: submitted,
      feedback: "Keep implementation changes scoped.",
    };
    assert.deepEqual(interactionResolutionSchema.parse(approval), approval);
  }
  assert.equal(
    profileConfirmationSchema.safeParse({
      ...confirmation,
      choices: { permissionRuleSetId: "autonomous" },
    }).success,
    false,
  );
  assert.equal(
    profileConfirmationSchema.safeParse({
      ...confirmation,
      choices: { model: { provider: "p" } },
    }).success,
    false,
  );
  assert.equal(
    interactionResolutionSchema.safeParse({
      kind: "plan_review",
      decision: "approve",
    }).success,
    false,
  );
});

test("stale/untrusted/unavailable targets and requirement conflicts refresh confirmation without settling the review", () => {
  for (const reason of [
    "target_changed",
    "target_unavailable",
    "target_untrusted",
    "requirement_conflict",
    "configuration_changed",
  ]) {
    const refreshed = { status: "refresh_required", reason, diagnostics: [] };
    assert.deepEqual(profileTransitionResultSchema.parse(refreshed), refreshed);
    assert.deepEqual(
      interactionResolveResultSchema.parse(refreshed),
      refreshed,
    );
  }
  const applied = {
    status: "applied",
    source,
    effective,
  };
  assert.deepEqual(profileTransitionResultSchema.parse(applied), applied);
  assert.equal(
    profileTransitionResultSchema.safeParse({
      ...applied,
      transitionId: "obsolete",
    }).success,
    false,
  );
  const missingCorrelation = { ...expected, targetProfile };
  assert.equal(
    profileConfirmationSchema.safeParse(missingCorrelation).success,
    false,
  );
  assert.equal(
    profileTransitionResultSchema.safeParse({
      status: "failed",
      error: "stale profile",
    }).success,
    false,
  );
});

test("new-conversation and context-save DTOs do not accept materialized agent choices", () => {
  const create = {
    id: "c",
    projectId: "p",
    title: "New",
    config: {},
    overrides: { reasoningLevel: "high" },
    agentProfile: targetProfile,
  };
  assert.deepEqual(createConversationRequestSchema.parse(create), create);
  assert.equal(
    createConversationRequestSchema.safeParse({
      ...create,
      config: { model: { provider: "p", modelId: "m" } },
    }).success,
    false,
  );
  assert.equal(
    createConversationRequestSchema.safeParse({
      ...create,
      capabilityOverrides: {},
    }).success,
    false,
  );
  assert.deepEqual(
    configureConversationRequestSchema.parse({
      conversationId: "c",
      patch: { instructions: null },
    }),
    { conversationId: "c", patch: { instructions: null } },
  );
  assert.equal(
    configureConversationRequestSchema.safeParse({
      conversationId: "c",
      patch: { reasoningLevel: "high" },
    }).success,
    false,
  );
});
