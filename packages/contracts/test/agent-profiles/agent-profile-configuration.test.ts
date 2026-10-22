import assert from "node:assert/strict";
import test from "node:test";
import {
  agentProfileFileSchema,
  parseAgentProfileFile,
  resolveAgentProfiles,
  applyAgentProfilePatch,
  type AgentProfileDraft,
} from "../../src/domains/agent-profiles/index.js";
const base: AgentProfileDraft = {
  name: "reader",
  description: "Read",
  usableBy: "both",
  instructions: "Original",
  permission: { set: "read_only" },
};
const file = (override: Record<string, unknown> = {}) => ({
  schemaVersion: 2,
  ...base,
  ...override,
});

test("profile files are named versioned templates and reject aggregates/filename mismatches", () => {
  assert.equal(parseAgentProfileFile(file(), "reader.json").name, "reader");
  assert.throws(
    () => parseAgentProfileFile(file(), "different.json"),
    /match filename/,
  );
  assert.throws(
    () => parseAgentProfileFile(file(), "../reader.json"),
    /match filename/,
  );
  assert.equal(
    agentProfileFileSchema.safeParse({
      schemaVersion: 1,
      profiles: { reader: base },
    }).success,
    false,
  );
});

test("injected catalogs resolve whole files in scope order; omission means use-settings", () => {
  const result = resolveAgentProfiles({
    builtins: [base],
    layers: [
      {
        source: "project",
        name: "reader",
        file: file({ instructions: "Project", permission: undefined }),
        trust: "trusted",
        digest: "project-file",
      },
      {
        source: "user",
        name: "reader",
        file: file({ instructions: "User" }),
        digest: "user-file",
      },
    ],
  });
  const profile = result.profiles[0]!;
  assert.equal(profile.inherited?.instructions, "User");
  assert.equal(profile.effective?.instructions, "Project");
  assert.equal(profile.effective?.permission, undefined);
  assert.equal(profile.digest, "project-file");
  const deleted = resolveAgentProfiles({
    builtins: [base],
    layers: [
      { source: "user", name: "reader", file: file({ instructions: "User" }) },
    ],
  });
  assert.equal(deleted.profiles[0]!.effective?.instructions, "User");
});

test("invalid and untrusted files block only their own names; trust is per file", () => {
  const result = resolveAgentProfiles({
    builtins: [base, { ...base, name: "other" }],
    layers: [
      {
        source: "project",
        name: "reader",
        file: file(),
        digest: "reader-digest",
        trust: "untrusted",
      },
      {
        source: "project",
        name: "other",
        file: file({ name: "other" }),
        digest: "other-digest",
        trust: "trusted",
      },
    ],
  });
  assert.match(
    result.profiles.find((p) => p.name === "reader")!.effective!.error!,
    /Trust the current reader.json/,
  );
  assert.equal(
    result.profiles.find((p) => p.name === "other")!.effective!.error,
    undefined,
  );
  const malformed = resolveAgentProfiles({
    builtins: [base],
    layers: [
      {
        source: "user",
        name: "reader",
        file: { schemaVersion: 2, name: "wrong" },
      },
    ],
  });
  assert.equal(malformed.profiles[0]!.effective, null);
  assert.equal(malformed.profiles[0]!.diagnostics[0]!.code, "invalid_file");
});

test("patches remove one setting/tool without resetting others or mutating their inputs", () => {
  const input: AgentProfileDraft = {
    ...base,
    tools: {
      web_search: { set: { enabled: true, profileId: "account" } },
      python_exec: {
        lock: { enabled: true, settings: { interpreterPath: "/bin/python" } },
      },
    },
  };
  const before = structuredClone(input);
  const next = applyAgentProfilePatch(input, {
    permission: null,
    tools: { web_search: null },
  });
  assert.equal(next.permission, undefined);
  assert.equal(next.tools?.web_search, undefined);
  assert.deepEqual(next.tools?.python_exec, before.tools?.python_exec);
  assert.deepEqual(input, before);
  assert.throws(
    () =>
      applyAgentProfilePatch({ ...base, model: "lead" }, { usableBy: "lead" }),
    /Same as lead/,
  );
});

test("model and thinking patches reset independently", () => {
  const input: AgentProfileDraft = {
    ...base,
    model: { lock: { provider: "test", modelId: "chosen" } },
    thinking: { set: "high" },
  };
  const modelReset = applyAgentProfilePatch(input, { model: null });
  assert.equal(modelReset.model, undefined);
  assert.deepEqual(modelReset.thinking, { set: "high" });
  const thinkingReset = applyAgentProfilePatch(input, { thinking: null });
  assert.equal(thinkingReset.thinking, undefined);
  assert.deepEqual(thinkingReset.model, input.model);
});

test("portable profile names do not read prototype entries", () => {
  const profile = { ...base, name: "constructor" };
  const result = resolveAgentProfiles({ builtins: [profile], layers: [] });
  assert.deepEqual(
    result.profiles.map((p) => p.name),
    ["constructor"],
  );
});
