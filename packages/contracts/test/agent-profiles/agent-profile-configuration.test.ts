import assert from "node:assert/strict";
import test from "node:test";
import {
  applyAgentProfilePatch,
  resolveAgentProfiles,
  agentProfilePatchSchema,
  agentProfilesConfigurationSchema,
  agentProfilesDocumentSchema,
  agentProfilesUpdateParamsSchema,
  type AgentProfilesDocument,
} from "../../src/domains/agent-profiles/index.js";

const document = (
  profiles: AgentProfilesDocument["profiles"],
): AgentProfilesDocument => ({ schemaVersion: 1, profiles });

test("constructor profiles inherit across empty higher layers without prototype entries", () => {
  const custom = {
    description: "Custom research profile",
    usableBy: "both",
    model: "inherit",
    thinking: "inherit",
    permission: "read_only",
    compaction: "inherit",
    skills: "none",
    instructions: "Investigate",
  } as const;
  const result = resolveAgentProfiles({
    layers: [
      { source: "user", document: document({ constructor: custom }) },
      { source: "project", document: document({}) },
      { source: "conversation", document: document({}) },
    ],
  });
  const profile = result.profiles.find(
    (profile) => profile.name === "constructor",
  )!;
  assert.deepEqual(profile.diagnostics, []);
  assert.equal(profile.effective?.instructions, "Investigate");
  assert.equal(profile.effective?.source, "user");
  assert.equal(profile.effective?.error, undefined);
  assert.equal(profile.local, null);
  assert.equal(profile.inherited?.instructions, "Investigate");
});

test("portable dictionary keys survive schema, patching, resolution and JSON without prototype mutation", () => {
  const selections = JSON.parse(
    '{"__proto__":{"__proto__":true,"polluted":true},"constructor":true,"toString":false}',
  );
  const skills = JSON.parse('{"__proto__":true,"constructor":true}');
  const patch = agentProfilePatchSchema.parse({ tools: selections, skills });
  assert.deepEqual(patch.tools, selections);
  const original = document({ developer: { tools: selections, skills } });
  assert.deepEqual(agentProfilesDocumentSchema.parse(original), original);
  const updated = applyAgentProfilePatch(document({}), "developer", patch);
  assert.deepEqual(updated.profiles.developer?.tools, selections);
  assert.deepEqual(updated.profiles.developer?.skills, skills);
  assert.deepEqual(JSON.parse(JSON.stringify(updated)), original);
  for (const dictionary of [
    selections,
    patch.tools,
    updated.profiles.developer?.tools,
    updated.profiles.developer?.skills,
  ]) {
    assert.equal(Object.getPrototypeOf(dictionary), Object.prototype);
    assert.equal(Object.hasOwn(dictionary!, "__proto__"), true);
  }
  assert.equal(Object.hasOwn(Object.prototype, "polluted"), false);
  const resolved = resolveAgentProfiles({
    scope: "user",
    layers: [{ source: "user", document: updated }],
  });
  const profile = resolved.profiles.find(
    (profile) => profile.name === "developer",
  )!;
  assert.deepEqual(profile.effective?.tools, selections);
  assert.equal(Object.hasOwn(profile.origins.tools, "__proto__"), true);
  assert.equal(profile.origins.tools["__proto__"], "user");
  assert.equal(profile.origins.skills["__proto__"], "user");
  assert.equal(Object.getPrototypeOf(profile.origins.tools), Object.prototype);
  assert.equal(profile.effective?.error, undefined);
  assert.equal(
    agentProfilesConfigurationSchema.safeParse(resolved).success,
    true,
  );
  const reset = applyAgentProfilePatch(updated, "developer", {
    tools: JSON.parse('{"__proto__":null}'),
  });
  assert.equal(
    Object.hasOwn(reset.profiles.developer!.tools!, "__proto__"),
    false,
  );
  assert.equal(
    Object.hasOwn(updated.profiles.developer!.tools!, "__proto__"),
    true,
  );
});

test("versioned sparse documents preserve unknown references and reject forbidden settings", () => {
  assert.deepEqual(
    agentProfilesDocumentSchema.parse(
      document({ developer: { enabled: false, tools: { future_tool: true } } }),
    ).profiles.developer,
    { enabled: false, tools: { future_tool: true } },
  );
  for (const invalid of [
    { schemaVersion: 2, profiles: {} },
    document({ developer: { tools: { bash: true } } }),
    document({ developer: { permission: { lock: "inherit" } as never } }),
    document({ developer: { enabled: null as never } }),
  ])
    assert.equal(agentProfilesDocumentSchema.safeParse(invalid).success, false);
  assert.equal(
    agentProfilePatchSchema.safeParse({
      model: null,
      tools: { future_tool: null },
    }).success,
    true,
  );
  assert.equal(
    agentProfilePatchSchema.safeParse({ tools: { subagents: true } }).success,
    false,
  );
});

test("resolution merges scalars and selections but replaces compaction and modes", () => {
  const result = resolveAgentProfiles({
    layers: [
      {
        source: "conversation",
        document: document({
          developer: {
            enabled: true,
            model: "inherit",
            tools: { future_tool: true },
            skills: { extra: true },
          },
        }),
      },
      {
        source: "user",
        document: document({
          developer: {
            enabled: false,
            model: "openai/example",
            tools: { web_search: false },
            skills: { base: true },
            compaction: { profile: "custom", triggerPercent: 80 },
          },
        }),
      },
      {
        source: "project",
        document: document({
          developer: {
            thinking: "high",
            tools: { web_search: true },
            skills: { base: false },
            compaction: { profile: "balanced" },
          },
        }),
      },
    ],
  });
  const profile = result.profiles.find((p) => p.name === "developer")!;
  assert.equal(profile.effective?.enabled, true);
  assert.equal(profile.effective?.model, "inherit");
  assert.equal(profile.effective?.thinking, "high");
  assert.deepEqual(profile.effective?.tools, {
    web_search: true,
    future_tool: true,
  });
  assert.deepEqual(profile.effective?.skills, { base: false, extra: true });
  assert.deepEqual(profile.effective?.compaction, { profile: "balanced" });
  assert.equal(profile.origins.fields.model, "conversation");
  assert.equal(profile.origins.tools.web_search, "project");
  assert.equal(profile.origins.skills.base, "project");
  assert.equal(profile.inherited?.model, "openai/example");
  assert.equal(profile.local?.model, "inherit");
  assert.equal(profile.diagnostics[0]?.severity, "warning");
  assert.equal(profile.effective?.error, undefined);
  assert.equal(
    agentProfilesConfigurationSchema.safeParse(result).success,
    true,
  );
  const modes = resolveAgentProfiles({
    layers: [
      {
        source: "user",
        document: document({ developer: { skills: { base: true } } }),
      },
      {
        source: "project",
        document: document({ developer: { skills: "none" } }),
      },
    ],
  });
  assert.equal(
    modes.profiles.find((p) => p.name === "developer")?.effective?.skills,
    "none",
  );
  assert.deepEqual(
    modes.profiles.find((p) => p.name === "developer")?.origins.skills,
    {},
  );
});

test("equal values stay pinned and reset deletes local fields or selections without mutating inputs", () => {
  const original = document({
    developer: {
      model: "inherit",
      tools: { web_search: false, future_tool: true },
      skills: { one: true, two: false },
    },
  });
  const pinned = applyAgentProfilePatch(original, "developer", {
    thinking: "inherit",
  });
  assert.equal(pinned.profiles.developer?.model, "inherit");
  const reset = applyAgentProfilePatch(pinned, "developer", {
    model: null,
    tools: { web_search: null },
    skills: { one: null },
  });
  assert.equal(reset.profiles.developer?.model, undefined);
  assert.deepEqual(reset.profiles.developer?.tools, { future_tool: true });
  assert.deepEqual(reset.profiles.developer?.skills, { two: false });
  assert.equal(original.profiles.developer?.model, "inherit");
  assert.deepEqual(
    applyAgentProfilePatch(reset, "developer", null),
    document({}),
  );
});

test("invalid higher entries block without hiding unrelated profiles; malformed documents block resolution", () => {
  const result = resolveAgentProfiles({
    layers: [
      {
        source: "project",
        document: {
          schemaVersion: 1,
          profiles: {
            developer: { permission: { lock: "inherit" } },
            reviewer: { enabled: true },
          },
        },
      },
    ],
  });
  assert.ok(
    result.profiles.find((p) => p.name === "developer")?.effective?.error,
  );
  assert.equal(
    result.profiles.find((p) => p.name === "explore")?.effective?.error,
    undefined,
  );
  assert.equal(
    result.profiles.find((p) => p.name === "reviewer")?.effective,
    null,
  );
  assert.equal(result.document?.schemaVersion, 1); // Target conversation has no local document.
  const malformed = resolveAgentProfiles({
    scope: "project",
    layers: [
      { source: "project", document: { schemaVersion: 9, profiles: {} } },
    ],
  });
  assert.equal(malformed.document, null);
  assert.equal(malformed.diagnostics[0]?.code, "invalid_document");
  assert.ok(malformed.profiles.every((p) => p.effective?.error));
});

test("JSON null is malformed, while absent documents inherit", () => {
  const malformed = resolveAgentProfiles({
    scope: "user",
    layers: [{ source: "user", document: null }],
  });
  assert.equal(malformed.document, null);
  assert.equal(malformed.diagnostics[0]?.code, "invalid_document");
  assert.ok(malformed.profiles.every((profile) => profile.effective?.error));
  const missing = resolveAgentProfiles({
    scope: "user",
    layers: [{ source: "user" }],
  });
  assert.deepEqual(missing.document, document({}));
  assert.deepEqual(missing.diagnostics, []);
  assert.ok(missing.profiles.every((profile) => !profile.effective?.error));
});

test("project trust survives higher overrides and availability blockers preserve explicit choices", () => {
  const result = resolveAgentProfiles({
    layers: [
      {
        source: "project",
        trust: "untrusted",
        document: document({
          developer: { instructions: "Project instructions" },
        }),
      },
      {
        source: "conversation",
        document: document({
          developer: { model: "missing/model", enabled: true },
        }),
      },
    ],
    diagnostics: (profile) =>
      profile.model === "missing/model"
        ? [
            {
              severity: "blocking",
              code: "unavailable_model",
              field: "model",
              message: "Configure missing/model",
            },
          ]
        : [],
  });
  const profile = result.profiles.find((p) => p.name === "developer")!;
  assert.equal(profile.trust, "untrusted");
  assert.equal(profile.effective?.model, "missing/model");
  assert.deepEqual(
    profile.diagnostics.map((d) => d.code),
    ["untrusted_project", "unavailable_model"],
  );
  assert.equal(
    result.profiles.find((p) => p.name === "explore")?.effective?.error,
    undefined,
  );
});

test("scoped updates require ownership IDs and accept optimistic absent-file assertions", () => {
  assert.equal(
    agentProfilesUpdateParamsSchema.safeParse({
      scope: "conversation",
      name: "developer",
      patch: { thinking: "high" },
    }).success,
    false,
  );
  assert.equal(
    agentProfilesUpdateParamsSchema.safeParse({
      scope: "project",
      name: "developer",
      patch: {},
    }).success,
    false,
  );
  assert.equal(
    agentProfilesUpdateParamsSchema.safeParse({
      scope: "conversation",
      conversationId: "c",
      expectedDigest: null,
      name: "developer",
      patch: { thinking: "high" },
    }).success,
    true,
  );
});
