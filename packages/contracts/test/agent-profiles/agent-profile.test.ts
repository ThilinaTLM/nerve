import assert from "node:assert/strict";
import test from "node:test";
import {
  AGENT_PROFILE_INSTRUCTIONS_MAX_BYTES,
  agentProfileDraftSchema,
  agentProfileNameSchema,
} from "../../src/domains/agent-profiles/index.js";
import { conversationConfigSchema } from "../../src/domains/core/conversation.js";
import {
  configureConversationRequestSchema,
  createConversationRequestSchema,
} from "../../src/domains/core/core-operations.js";
const valid = {
  name: "reader",
  description: "Reads things.",
  usableBy: "subagent",
  instructions: "Research",
} as const;
const parse = (override: Record<string, unknown>) =>
  agentProfileDraftSchema.safeParse({ ...valid, ...override });

test("profiles use independent model/thinking and the canonical typed tool payloads", () => {
  assert.equal(parse({}).success, true);
  assert.equal(
    parse({
      model: { set: { provider: "openai", modelId: "test" } },
      thinking: { set: "high" },
      permission: { lock: "read_only" },
      tools: {
        web_search: { set: { enabled: true, profileId: "research" } },
        plan_present: {
          set: { enabled: true, settings: { approvalProfile: "coding" } },
        },
        bash: {
          lock: {
            settings: {
              maxTimeoutMs: 5000,
              autoPromotion: { enabled: false, afterMs: 1000 },
              shellPath: "/bin/sh",
            },
          },
        },
      },
    }).success,
    true,
  );
  for (const override of [
    { model: { set: "openai/model" } },
    {
      model: {
        set: {
          model: { provider: "openai", modelId: "test" },
          thinking: "high",
        },
      },
    },
    { model: "inherit" },
    { permission: "default" },
    { tools: { bash: { set: { enabled: false } } } },
    { tools: { read: { set: { enabled: false } } } },
    { tools: { ask_user: { lock: { enabled: false } } } },
    { tools: { web_fetch: { set: { profileId: "account" } } } },
    { tools: { kroki_export: { set: { settings: { url: "ftp://host" } } } } },
  ])
    assert.equal(parse(override).success, false, JSON.stringify(override));
});

test("same-as-lead is valid only for sub-agent-usable profiles, including tools and skills", () => {
  for (const setting of [
    { model: "lead" },
    { thinking: "lead" },
    { permission: "lead" },
    { compaction: "lead" },
    { skills: "lead" },
    { tools: { web_search: "lead" } },
  ]) {
    assert.equal(parse({ ...setting, usableBy: "lead" }).success, false);
    assert.equal(parse({ ...setting, usableBy: "subagent" }).success, true);
    assert.equal(parse({ ...setting, usableBy: "both" }).success, true);
  }
});

test("compaction uses canonical settings and rejects legacy retention/trigger fields", () => {
  assert.equal(
    parse({
      compaction: {
        set: { auto: true, profile: "custom", customTriggerPercent: 75 },
      },
    }).success,
    true,
  );
  for (const extra of [
    { keepRecentPercent: 15 },
    { triggerPercent: 75 },
    { customTriggerPercent: 59 },
  ])
    assert.equal(
      parse({
        compaction: {
          set: {
            auto: true,
            profile: "custom",
            customTriggerPercent: 80,
            ...extra,
          },
        },
      }).success,
      false,
    );
});

test("profile names use lowercase words with single hyphens", () => {
  for (const name of ["explore", "code-review", "a1"])
    assert.equal(agentProfileNameSchema.safeParse(name).success, true);
  for (const name of ["", "Explore", "a--b", "-a", "a-", "a_b", "x".repeat(33)])
    assert.equal(agentProfileNameSchema.safeParse(name).success, false, name);
});

test("instructions are bounded by UTF-8 bytes", () => {
  const draft = { ...valid, name: "reader", instructions: "" };
  const atLimit = "é".repeat(AGENT_PROFILE_INSTRUCTIONS_MAX_BYTES / 2);
  assert.equal(
    agentProfileDraftSchema.safeParse({ ...draft, instructions: atLimit })
      .success,
    true,
  );
  assert.equal(
    agentProfileDraftSchema.safeParse({
      ...draft,
      instructions: `${atLimit}x`,
    }).success,
    false,
  );
});

test("conversation config carries nullable instructions that default to null on create", () => {
  const base = {
    model: { provider: "openai", modelId: "gpt-5" },
    reasoningLevel: "off",
    systemPrompt: null,
    permissionRuleSetId: "autonomous",
    agentProfile: "coding",
    workingDirectory: "/tmp",
  };
  assert.equal(
    conversationConfigSchema.safeParse({ conversationId: "c", ...base })
      .success,
    false,
  );
  assert.equal(
    conversationConfigSchema.safeParse({
      conversationId: "c",
      ...base,
      instructions: "hi",
    }).success,
    true,
  );
  assert.equal(
    createConversationRequestSchema.parse({
      id: "c",
      projectId: "p",
      title: "t",
      config: base,
    }).config.instructions,
    null,
  );
  const patch = configureConversationRequestSchema.parse({
    conversationId: "c",
    patch: { reasoningLevel: "low" },
  }).patch;
  assert.equal("instructions" in patch, false);
  assert.equal(
    configureConversationRequestSchema.parse({
      conversationId: "c",
      patch: { instructions: null },
    }).patch.instructions,
    null,
  );
});
