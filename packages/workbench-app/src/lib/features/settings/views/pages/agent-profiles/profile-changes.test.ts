import assert from "node:assert/strict";
import { test } from "node:test";
import { profileDefinitionSchema } from "@nervekit/contracts/agent-configuration";
import { applyProfileChange, changeRows } from "./profile-changes";
const model = { provider: "test", modelId: "one" };
const base = profileDefinitionSchema.parse({
  schemaVersion: 1,
  name: "planning",
  description: "Plan first",
  usableBy: "lead",
  instructions: "Plan carefully.",
  recommendations: {
    model,
    reasoningLevel: "low",
    tools: { web_search: { enabled: true } },
  },
  requirements: { permissionRuleSetId: "read_only" },
});
test("Use settings removes both contributions, preserving unrelated settings and instructions", () => {
  const result = applyProfileChange(base, {
    key: "permission",
    mode: "settings",
    value: "read_only",
  });
  assert.equal(result.requirements?.permissionRuleSetId, undefined);
  assert.deepEqual(result.recommendations, base.recommendations);
  assert.equal(result.instructions, base.instructions);
  assert.equal(base.requirements?.permissionRuleSetId, "read_only");
});
test("model picker payload writes both settings while retaining independent policy modes", () => {
  const result = applyProfileChange(base, {
    key: "model",
    mode: "recommend",
    value: {
      model,
      thinking: "high",
      modelMode: "settings",
      thinkingMode: "require",
    },
  });
  assert.equal(result.recommendations?.model, undefined);
  assert.equal(result.requirements?.model, undefined);
  assert.equal(result.recommendations?.reasoningLevel, undefined);
  assert.equal(result.requirements?.reasoningLevel, "high");
  const row = changeRows(result).find((r) => r.key === "model")!;
  assert.deepEqual(row.value, {
    model: undefined,
    thinking: "high",
    modelMode: "settings",
    thinkingMode: "require",
  });
});
test("a policy mode without its value cannot silently become Use settings", () => {
  assert.throws(
    () =>
      applyProfileChange(base, {
        key: "model",
        mode: "require",
        value: { model, thinkingMode: "require" },
      }),
    /Choose a value for reasoningLevel/,
  );
  assert.equal(base.recommendations?.reasoningLevel, "low");
});
test("moving a tool policy removes the other contribution without touching other fields", () => {
  const result = applyProfileChange(base, {
    key: "tool:web_search",
    mode: "require",
    value: { enabled: false },
  });
  assert.equal(result.recommendations?.tools?.web_search, undefined);
  assert.deepEqual(result.requirements?.tools?.web_search, { enabled: false });
  assert.equal(result.requirements?.permissionRuleSetId, "read_only");
});
test("mixed tool policies display once with all values, avoiding dropped recommendations on edit", () => {
  const profile = profileDefinitionSchema.parse({
    ...base,
    recommendations: { tools: { web_search: { enabled: true } } },
    requirements: { tools: { web_search: { profileId: "account" } } },
  });
  const rows = changeRows(profile).filter((r) => r.key === "tool:web_search");
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.mixed, true);
  assert.deepEqual(rows[0]!.value, { enabled: true, profileId: "account" });
  const next = applyProfileChange(profile, {
    key: rows[0]!.key,
    mode: "recommend",
    value: rows[0]!.value,
  });
  assert.deepEqual(next.recommendations?.tools?.web_search, {
    enabled: true,
    profileId: "account",
  });
});
test("child definitions use the same real recommendations/requirements schema and editable instructions", () => {
  const child = profileDefinitionSchema.parse({
    schemaVersion: 1,
    name: "research",
    description: "Research",
    usableBy: "subagent",
    instructions: "Read.",
  });
  const next = applyProfileChange(child, {
    key: "tool:web_fetch",
    mode: "require",
    value: { enabled: false },
  });
  assert.equal(next.requirements?.tools?.web_fetch?.enabled, false);
  assert.equal(
    applyProfileChange(next, {
      key: "instructions",
      mode: "recommend",
      value: "",
    }).instructions,
    "",
  );
  assert.equal(next.usableBy, "subagent");
});
