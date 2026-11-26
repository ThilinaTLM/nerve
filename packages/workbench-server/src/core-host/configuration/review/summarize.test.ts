import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  PermissionRule,
  PermissionRuleFilter,
  PermissionRuleSet,
} from "@nervekit/contracts/permissions";
import { builtInPermissionRuleSets } from "@nervekit/tools/policy";
import { toItems } from "./review-lines.js";
import {
  agentPreferencesLines,
  profileLines,
  type AgentReviewLookups,
} from "./summarize-agent.js";
import {
  overlayLines,
  ruleSetActsWithoutAsking,
  ruleSetLines,
} from "./summarize-permissions.js";
import { skillLines } from "./summarize-skill.js";

let priority = 0;
const rule = (
  decision: PermissionRule["decision"],
  when: PermissionRuleFilter,
): PermissionRule => ({
  id: `rule-${priority}`,
  enabled: true,
  priority: priority++,
  enforcement: "overridable",
  when,
  decision,
});
const ruleSet = (...rules: PermissionRule[]): PermissionRuleSet => ({
  schemaVersion: 1,
  id: "mine",
  name: "Mine",
  source: "user",
  enabled: true,
  rules,
});
const broadTexts = (lines: { text: string; broad: boolean }[]) =>
  lines.filter((entry) => entry.broad).map((entry) => entry.text);

void test("an allow with no condition, any command, the Nerve folders or outside changes is broad", () => {
  const lines = ruleSetLines(
    ruleSet(
      rule("allow", {}),
      rule("allow", { toolNames: ["bash"] }),
      rule("allow", {
        toolNames: ["write"],
        primaryTarget: { root: "nerve_home", access: "write" },
      }),
      rule("allow", { baseRisks: ["external_write"] }),
    ),
  );
  assert.deepEqual(broadTexts(lines).sort(), [
    "Allows any shell command without asking",
    "Allows changes to outside services without asking",
    "Allows changes to the Nerve home folder without asking",
    "Allows every call without asking",
  ]);
  for (const entry of lines) assert.ok(entry.short.length <= 32, entry.short);
});

void test("a specific command or a command pattern is not broad, a leading wildcard is", () => {
  const lines = ruleSetLines(
    ruleSet(
      rule("allow", {
        toolNames: ["bash"],
        primaryArgument: { operator: "equals", value: "pnpm test" },
      }),
      rule("allow", {
        toolNames: ["bash"],
        primaryArgument: { operator: "glob", value: "scripts/*" },
      }),
      rule("allow", {
        toolNames: ["bash"],
        primaryArgument: { operator: "glob", value: "*" },
      }),
      rule("prompt", {
        toolNames: ["bash"],
        primaryArgument: { operator: "equals", value: "git push" },
      }),
      rule("deny", {}),
    ),
  );
  assert.deepEqual(broadTexts(lines), [
    "Allows commands matching `*` without asking",
  ]);
  const texts = lines.map((entry) => entry.text);
  assert.ok(texts.includes("Allows `pnpm test` without asking"));
  assert.ok(texts.includes("Asks before `git push`"));
  assert.ok(texts.includes("Refuses everything else"));
  assert.equal(lines[0]?.short, "Allows commands matching *");
});

void test("disabled rules and long files are cut down, broad rules first", () => {
  const many = Array.from({ length: 20 }, (_, index) =>
    rule("allow", { toolNames: [`tool-${index}`] }),
  );
  const lines = ruleSetLines(
    ruleSet(
      ...many,
      { ...rule("allow", {}), enabled: false },
      rule("allow", { toolNames: ["bash"] }),
    ),
  );
  assert.equal(lines[0]?.broad, true);
  assert.equal(lines.length, 13);
  assert.match(lines.at(-1)!.text, /^And 9 more rules$/);
  assert.ok(!lines.some((entry) => entry.text.startsWith("Allows every call")));
});

void test("an overlay names the rule set its rules belong to only when there are several", () => {
  const single = overlayLines({
    schemaVersion: 2,
    overlays: [
      {
        ruleSetId: "supervised",
        rules: [rule("allow", { toolNames: ["bash"] })],
      },
    ],
  });
  assert.equal(single[0]?.text, "Allows any shell command without asking");
  const several = overlayLines({
    schemaVersion: 2,
    overlays: [
      {
        ruleSetId: "supervised",
        rules: [rule("allow", { toolNames: ["bash"] })],
      },
      {
        ruleSetId: "autonomous",
        rules: [rule("prompt", { toolNames: ["write"] })],
      },
    ],
  });
  assert.ok(
    several.some((entry) =>
      entry.text.endsWith("while `supervised` is selected"),
    ),
  );
});

void test("built-in rule sets: only autonomous acts without asking", () => {
  const acts = Object.fromEntries(
    builtInPermissionRuleSets.map((entry) => [
      entry.id,
      ruleSetActsWithoutAsking(entry),
    ]),
  );
  assert.deepEqual(acts, {
    baseline: false,
    read_only: false,
    supervised: false,
    autonomous: true,
    planning: false,
  });
});

const lookups = (
  ruleSets: Record<string, PermissionRuleSet>,
  profiles: Record<string, string> = {},
): AgentReviewLookups => ({
  ruleSet: async (id) => ruleSets[id],
  profileRuleSetId: async (name) => profiles[name],
});
const autonomous = builtInPermissionRuleSets.find(
  (entry) => entry.id === "autonomous",
)!;
const supervised = builtInPermissionRuleSets.find(
  (entry) => entry.id === "supervised",
)!;

void test("a profile that requires a rule set that acts without asking, or turns on delegation, is broad", async () => {
  const lines = await profileLines(
    {
      schemaVersion: 1,
      name: "reviewer",
      whenToUse: "Reviews code",
      usableBy: "both",
      instructions: "a\nb\nc",
      requirements: {
        permissionRuleSetId: "autonomous",
        tools: { subagents: { enabled: true } },
      },
      recommendations: { permissionRuleSetId: "supervised" },
    },
    "user",
    lookups({ autonomous, supervised }),
  );
  assert.deepEqual(broadTexts(lines), [
    "Runs without asking: requires the `autonomous` rule set",
    "Turns on delegation to sub-agents",
  ]);
  assert.equal(lines[0]?.short, "Runs without asking");
  assert.ok(
    lines.some(
      (entry) => entry.text === "Recommends the `supervised` rule set",
    ),
  );
  assert.ok(lines.some((entry) => entry.text === "3 lines of instructions"));
  assert.ok(
    lines.some((entry) =>
      entry.text.startsWith(
        "Selectable as the main agent and offered as a sub-agent in every project",
      ),
    ),
  );
  for (const entry of lines) assert.ok(entry.short.length <= 32, entry.short);
});

void test("a profile with no risky setting has no broad item", async () => {
  const lines = await profileLines(
    {
      schemaVersion: 1,
      name: "docs",
      whenToUse: "Writes docs",
      usableBy: "subagent",
      enabled: false,
      instructions: "",
      requirements: {
        permissionRuleSetId: "supervised",
        model: { provider: "p", modelId: "m1" },
        reasoningLevel: "low",
      },
    },
    "project",
    lookups({ supervised }),
  );
  assert.deepEqual(broadTexts(lines), []);
  assert.ok(lines.some((entry) => entry.text === "Uses `m1`, thinking low"));
  assert.ok(
    lines.some((entry) => entry.text.startsWith("Not offered as a sub-agent")),
  );
});

void test("agent.json is broad when it selects an acting rule set or turns on an autonomous sub-agent", async () => {
  const lines = await agentPreferencesLines(
    {
      schemaVersion: 1,
      revision: 1,
      overrides: {
        permissionRuleSetId: "autonomous",
        subagents: { reviewer: { enabled: true }, docs: { enabled: true } },
      },
    },
    lookups(
      { autonomous, supervised },
      { reviewer: "autonomous", docs: "supervised" },
    ),
  );
  assert.deepEqual(broadTexts(lines), [
    "Runs without asking: uses the `autonomous` rule set",
    "Turns on the sub-agent `reviewer`, which runs without asking",
  ]);
  assert.ok(
    lines.some((entry) => entry.text === "Turns on the sub-agent `docs`"),
  );
});

void test("a skill with a script is broad; its other files are only counted", () => {
  const lines = skillLines({
    description: "Draft release notes",
    scope: "project",
    files: [
      { path: "SKILL.md", bytes: 1, script: false },
      { path: "template.md", bytes: 1, script: false },
      { path: "scripts/collect.sh", bytes: 1, script: true },
    ],
  });
  assert.deepEqual(broadTexts(lines), [
    "May run a script: `scripts/collect.sh`",
  ]);
  assert.equal(lines[0]?.short, "May run a script");
  assert.deepEqual(
    lines.slice(1).map((entry) => entry.text),
    [
      "Offered to agents in this project as “Draft release notes”",
      "Reads a file that comes with it",
    ],
  );
});

void test("items: broad first, new only against a stored snapshot", () => {
  const lines = [
    { text: "b", short: "b", broad: false },
    { text: "a", short: "a", broad: true },
    { text: "c", short: "c", broad: false },
  ];
  assert.deepEqual(
    toItems(lines, ["b", "a"]).map((entry) => [entry.text, entry.new]),
    [
      ["a", false],
      ["b", false],
      ["c", true],
    ],
  );
  assert.ok(toItems(lines, undefined).every((entry) => !entry.new));
});
