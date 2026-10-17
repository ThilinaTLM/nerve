import assert from "node:assert/strict";
import test from "node:test";
import {
  SUBAGENT_INSTRUCTIONS_MAX_BYTES,
  builtInSubagentProfiles,
  subagentBlockedToolNames,
  subagentProfileDraftSchema,
  subagentProfileFieldsSchema,
  subagentProfileNameSchema,
} from "../../src/domains/subagents/index.js";
import { conversationConfigSchema } from "../../src/domains/core/conversation.js";
import {
  configureConversationRequestSchema,
  createConversationRequestSchema,
} from "../../src/domains/core/core-operations.js";

const valid = {
  description: "Reads things.",
  model: "lead",
  thinking: "lead",
  permission: "read_only",
  compaction: "inherit",
  skills: "none",
} as const;
const parse = (override: Record<string, unknown>) =>
  subagentProfileFieldsSchema.safeParse({ ...valid, ...override });

test("built-in profiles are valid drafts", () => {
  assert.deepEqual(
    builtInSubagentProfiles.map((profile) => profile.name),
    ["explore", "developer"],
  );
  for (const profile of builtInSubagentProfiles) {
    const result = subagentProfileDraftSchema.safeParse(profile);
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

test("legacy profile retention is stripped without loosening compaction validation", () => {
  const compaction = { auto: false, profile: "custom", triggerPercent: 73 };
  const parsed = subagentProfileFieldsSchema.parse({
    ...valid,
    compaction: { ...compaction, keepRecentPercent: 15 },
  });
  assert.deepEqual(parsed.compaction, compaction);
  for (const extra of [{ unknown: true }, { triggerPercent: 59 }]) {
    assert.equal(
      parse({
        compaction: { ...compaction, keepRecentPercent: 15, ...extra },
      }).success,
      false,
    );
  }
});

test("profile settings reject blocked tools, other rule sets and bad fields", () => {
  for (const name of subagentBlockedToolNames)
    assert.equal(parse({ tools: { [name]: true } }).success, false, name);
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
  assert.equal(parse({ permission: "plan" }).success, false);
  assert.equal(parse({ permission: "ask" }).success, false);
  assert.equal(parse({ description: "" }).success, false);
  assert.equal(parse({ description: "x".repeat(200) }).success, true);
  assert.equal(parse({ description: "x".repeat(201) }).success, false);
  assert.equal(parse({ model: "gpt-5" }).success, false);
  assert.equal(parse({ unknown: 1 }).success, false);
});

test("profile names use lowercase words with single hyphens", () => {
  for (const name of ["explore", "code-review", "a1"])
    assert.equal(subagentProfileNameSchema.safeParse(name).success, true);
  for (const name of ["", "Explore", "a--b", "-a", "a-", "a_b", "x".repeat(33)])
    assert.equal(
      subagentProfileNameSchema.safeParse(name).success,
      false,
      name,
    );
});

test("instructions are bounded by UTF-8 bytes", () => {
  const draft = { ...valid, name: "reader", instructions: "" };
  const atLimit = "é".repeat(SUBAGENT_INSTRUCTIONS_MAX_BYTES / 2);
  assert.equal(
    subagentProfileDraftSchema.safeParse({ ...draft, instructions: atLimit })
      .success,
    true,
  );
  assert.equal(
    subagentProfileDraftSchema.safeParse({
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
    mode: "coding",
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
