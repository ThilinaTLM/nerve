import assert from "node:assert/strict";
import test from "node:test";
import {
  AGENT_PROFILE_INSTRUCTIONS_MAX_BYTES,
  builtInAgentProfiles,
  agentProfileDraftSchema,
  agentProfileFieldsSchema,
  agentProfileNameSchema,
} from "../../src/domains/agent-profiles/index.js";
import { conversationConfigSchema } from "../../src/domains/core/conversation.js";
import {
  configureConversationRequestSchema,
  createConversationRequestSchema,
} from "../../src/domains/core/core-operations.js";

const valid = {
  usableBy: "subagent",
  description: "Reads things.",
  model: "inherit",
  thinking: "inherit",
  permission: "read_only",
  compaction: "inherit",
  skills: "none",
} as const;
const parse = (override: Record<string, unknown>) =>
  agentProfileFieldsSchema.safeParse({ ...valid, ...override });

test("built-in profiles are valid drafts", () => {
  assert.deepEqual(
    builtInAgentProfiles.map((profile) => profile.name),
    ["coding", "planning", "explore", "developer"],
  );
  for (const profile of builtInAgentProfiles) {
    const result = agentProfileDraftSchema.safeParse(profile);
    assert.equal(result.success, true, profile.name);
    assert.ok(profile.instructions.length > 0);
  }
});

test("profile settings accept the documented forms", () => {
  assert.equal(parse({}).success, true);
  assert.equal(parse({ model: "anthropic/claude-sonnet-4-5" }).success, true);
  assert.equal(
    parse({ thinking: "high", permission: "autonomous" }).success,
    true,
  );
  assert.equal(
    parse({
      compaction: {
        profile: "custom",
        triggerPercent: 75,
      },
    }).success,
    true,
  );
  assert.equal(parse({ skills: { release: false } }).success, true);
  assert.equal(
    parse({
      tools: {
        web_search: false,
        kroki_export: { url: "https://kroki.io/" },
      },
    }).success,
    true,
  );
});

test("compaction rejects legacy retention and unknown fields", () => {
  for (const extra of [
    { keepRecentPercent: 15 },
    { unknown: true },
    { triggerPercent: 59 },
  ])
    assert.equal(
      parse({ compaction: { profile: "custom", ...extra } }).success,
      false,
    );
});

test("profile settings reject non-configurable tools and bad fields", () => {
  for (const name of [
    "ask_user",
    "subagent_prompt",
    "subagent_status",
    "subagent_stop",
  ])
    assert.equal(parse({ tools: { [name]: true } }).success, false, name);
  assert.equal(parse({ tools: { plan_present: true } }).success, true);
  assert.equal(parse({ tools: { subagents: false } }).success, false);
  for (const name of ["edit", "write", "bash", "fileEditing"])
    assert.equal(parse({ tools: { [name]: false } }).success, false, name);
  assert.equal(parse({ tools: { made_up: false } }).success, true);
  assert.equal(
    parse({ tools: { future_tool: { option: "portable" } } }).success,
    true,
  );
  assert.equal(parse({ tools: { web_fetch: { url: "x" } } }).success, false);
  assert.equal(
    parse({ tools: { kroki_export: { url: "ftp://x" } } }).success,
    false,
  );
  assert.equal(parse({ permission: "plan" }).success, true);
  assert.equal(parse({ permission: "ask" }).success, true);
  assert.equal(parse({ description: "" }).success, false);
  assert.equal(parse({ description: "x".repeat(200) }).success, true);
  assert.equal(parse({ description: "x".repeat(201) }).success, false);
  assert.equal(parse({ model: "gpt-5" }).success, false);
  assert.equal(parse({ unknown: 1 }).success, false);
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
