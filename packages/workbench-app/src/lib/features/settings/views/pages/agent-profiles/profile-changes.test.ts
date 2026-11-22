import assert from "node:assert/strict";
import { test } from "node:test";
import { profileDefinitionSchema } from "@nervekit/contracts/agent-configuration";
import {
  applyProfileChange,
  changeRows,
  changeSections,
  unifyChangeMode,
  addableChanges,
  normalizeProfileName,
  duplicateProfileName,
  uniqueProfileName,
} from "./profile-changes";
const model = { provider: "test", modelId: "one" };
const base = profileDefinitionSchema.parse({
  schemaVersion: 1,
  name: "planning",
  whenToUse: "Use when planning first",
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
    recommendations: { tools: { python_exec: { enabled: true } } },
    requirements: {
      tools: { python_exec: { settings: { interpreterPath: "/py" } } },
    },
  });
  const rows = changeRows(profile).filter((r) => r.key === "tool:python_exec");
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.mixed, true);
  assert.deepEqual(rows[0]!.value, {
    enabled: true,
    settings: { interpreterPath: "/py" },
  });
  const next = applyProfileChange(profile, {
    key: rows[0]!.key,
    mode: "recommend",
    value: rows[0]!.value,
  });
  assert.deepEqual(next.recommendations?.tools?.python_exec, {
    enabled: true,
    settings: { interpreterPath: "/py" },
  });
});
test("child definitions use the same real recommendations/requirements schema and editable instructions", () => {
  const child = profileDefinitionSchema.parse({
    schemaVersion: 1,
    name: "research",
    whenToUse: "Use when researching",
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

test("skill item edits preserve other individual skills and independent policies", () => {
  const profile = profileDefinitionSchema.parse({
    ...base,
    recommendations: {
      skills: { file: { test: false } },
    },
    requirements: {
      skills: { file: { review: false }, agentBrowser: { browser: true } },
    },
  });
  const rows = changeRows(profile);
  assert.equal(rows.filter((row) => row.key === "skill:file:review").length, 1);
  assert.equal(
    rows.find((row) => row.key === "skill:file:review")?.value,
    false,
  );
  const next = applyProfileChange(profile, {
    key: "skill:file:review",
    mode: "settings",
    value: false,
  });
  assert.equal(next.requirements?.skills?.file?.review, undefined);
  assert.equal(next.recommendations?.skills?.file?.review, undefined);
  assert.equal(next.recommendations?.skills?.file?.test, false);
  assert.equal(next.requirements?.skills?.agentBrowser?.browser, true);
});

test("Remove instructions clears the contribution", () => {
  assert.equal(
    applyProfileChange(base, {
      key: "instructions",
      mode: "settings",
      value: base.instructions,
    }).instructions,
    "",
  );
});

test("a single model policy unifies existing fields but does not invent absent reasoning", () => {
  const next = unifyChangeMode(
    {
      key: "model",
      value: {
        model,
        thinking: "low",
        modelMode: "require",
        thinkingMode: "recommend",
      },
    },
    "require",
  );
  const profile = applyProfileChange(base, next);
  assert.equal(profile.requirements?.reasoningLevel, "low");
  assert.deepEqual(profile.requirements?.model, model);
  const modelOnly = applyProfileChange(
    base,
    unifyChangeMode({ key: "model", value: { model } }, "recommend"),
  );
  assert.equal(modelOnly.recommendations?.reasoningLevel, undefined);
  const removed = applyProfileChange(
    profile,
    unifyChangeMode(next, "settings"),
  );
  assert.equal(removed.requirements?.model, undefined);
  assert.equal(removed.requirements?.reasoningLevel, undefined);
});

test("add menu leaves out what the profile already changes and flips tools and skills from their state", () => {
  const groups = addableChanges({
    rows: [
      { key: "model", label: "Model", mode: "recommend", value: {} },
      {
        key: "skill:file:review",
        label: "Review",
        mode: "recommend",
        value: false,
      },
    ],
    tools: [
      { key: "tool:bash", label: "Bash" },
      { key: "tool:web_search", label: "Web search", defaultOn: true },
    ],
    skills: [
      { key: "skill:file:review", label: "Review", defaultOn: true },
      { key: "skill:nerve:research", label: "Research", defaultOn: false },
    ],
  });
  assert.deepEqual(
    groups.map((group) => [group.group, group.items.map((i) => i.key)]),
    [
      ["Basics", ["permission", "compaction", "instructions"]],
      ["Tools", ["tool:bash", "tool:web_search"]],
      ["Skills", ["skill:nerve:research"]],
    ],
  );
  const tools = groups.find((group) => group.group === "Tools")!.items;
  assert.equal(tools[0]?.opensEditor, true);
  assert.equal(tools[1]?.turnsTo, "Off");
  assert.equal(groups[2]?.items[0]?.turnsTo, "On");
});

test("legacy skill source defaults never become editable changes", () => {
  const legacy = {
    ...base,
    recommendations: {
      skills: { defaults: { file: false }, file: { review: true } },
    },
  };
  assert.deepEqual(
    changeRows(legacy).filter((row) => row.key.startsWith("skill")),
    [
      {
        key: "skill:file:review",
        label: "review",
        mode: "recommend",
        value: true,
      },
    ],
  );
});

test("profile names stay slugs and duplicates fit the identity length limit", () => {
  assert.equal(
    normalizeProfileName("UI_Developer helper!"),
    "ui-developer-helper",
  );
  assert.equal(duplicateProfileName("ui-developer"), "ui-developer-copy");
  assert.equal(duplicateProfileName("a".repeat(32)), `${"a".repeat(27)}-copy`);
  assert.equal(
    duplicateProfileName(`${"a".repeat(26)}-long`),
    `${"a".repeat(26)}-copy`,
  );
});
test("change sections group rows in a fixed order and drop empty sections", () => {
  const sections = changeSections(
    changeRows(
      profileDefinitionSchema.parse({
        ...base,
        recommendations: {
          ...base.recommendations,
          skills: { file: { review: true } },
        },
      }),
    ),
  );
  assert.deepEqual(
    sections.map((s) => [s.label, s.rows.map((r) => r.key)]),
    [
      ["Basics", ["model", "permission", "instructions"]],
      ["Tools", ["tool:web_search"]],
      ["Skills", ["skill:file:review"]],
    ],
  );
});

test("a taken profile name gets the next free number within the length limit", () => {
  assert.equal(uniqueProfileName("new-profile", []), "new-profile");
  assert.equal(
    uniqueProfileName("new-profile", ["new-profile", "new-profile-2"]),
    "new-profile-3",
  );
  const long = "a".repeat(32);
  assert.equal(uniqueProfileName(long, [long]).length, 32);
});
