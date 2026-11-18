// The configure-nerve skill documents configuration formats in prose because installed
// builds ship no sources. These tests fail when a documented catalog or limit drifts
// from the code it mirrors.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  AGENT_PROFILE_INSTRUCTIONS_MAX_BYTES,
  AGENT_PROFILE_LABEL_MAX_LENGTH,
  AGENT_PROFILE_NAME_MAX_LENGTH,
  AGENT_PROFILE_WHEN_TO_USE_MAX_LENGTH,
} from "@nervekit/contracts/agent-profiles";
import { launchDefinitionRunPolicySchema } from "@nervekit/contracts/launch-definitions";
import { thinkingLevelSchema } from "@nervekit/contracts/models";
import {
  pathRootSchema,
  staticToolRiskSchema,
  toolKindSchema,
} from "@nervekit/contracts/permissions";
import { compactionProfileSchema } from "@nervekit/contracts/settings";
import { toolPermissionMetadata } from "@nervekit/tools/catalog";
import { builtInPermissionRuleSets } from "@nervekit/tools/policy";
import { bundledAgentProfiles } from "../infrastructure/configuration/agent-configuration/builtins/index.js";

const reference = (name: string) =>
  readFile(
    fileURLToPath(
      new URL(`./builtin/configure-nerve/reference/${name}`, import.meta.url),
    ),
    "utf8",
  );

/** Rows of the first Markdown table whose header starts with `header`. */
function table(markdown: string, header: string): string[][] {
  const lines = markdown.split("\n");
  const start = lines.findIndex((line) => line.startsWith(`| ${header}`));
  assert.ok(start >= 0, `table "${header}" not found`);
  const rows: string[][] = [];
  for (const line of lines.slice(start + 2)) {
    if (!line.startsWith("|")) break;
    rows.push(
      line
        .slice(1, -1)
        .split(" | ")
        .map((cell) => cell.trim()),
    );
  }
  return rows;
}

const codeSpans = (text: string) =>
  [...text.replace(/^```[\s\S]*?^```/gm, "").matchAll(/`([^`\n]+)`/g)].map(
    (match) => match[1],
  );

function assertMentionsAll(markdown: string, values: readonly string[]) {
  const spans = new Set(codeSpans(markdown));
  for (const value of values)
    assert.ok(spans.has(value), `missing \`${value}\``);
}

void test("permissions reference mirrors tool metadata, built-in rule sets and enums", async () => {
  const markdown = await reference("permissions.md");

  const documented = new Set<string>();
  for (const [tools, classification] of table(markdown, "Tool ")) {
    const [kind, group, risk] = classification.split(" / ");
    for (const name of codeSpans(tools)) {
      documented.add(name);
      const metadata =
        toolPermissionMetadata[name as keyof typeof toolPermissionMetadata];
      assert.ok(metadata, `unknown tool ${name}`);
      assert.equal(kind, metadata.kind, `${name} kind`);
      if (group !== "the namespace")
        assert.equal(group, metadata.groups[0], `${name} group`);
      if (!risk.startsWith("per "))
        assert.equal(risk, metadata.baseRisk, `${name} risk`);
    }
  }
  assert.deepEqual(
    [...documented].sort(),
    Object.keys(toolPermissionMetadata).sort(),
  );

  assert.deepEqual(
    table(markdown, "Id ")
      .map(([id, name]) => `${id} ${name}`)
      .sort(),
    builtInPermissionRuleSets.map((set) => `\`${set.id}\` ${set.name}`).sort(),
  );

  assertMentionsAll(markdown, toolKindSchema.options);
  assertMentionsAll(markdown, staticToolRiskSchema.options);
  assertMentionsAll(markdown, pathRootSchema.options);
});

void test("agent profile reference mirrors built-ins, limits and enums", async () => {
  const markdown = await reference("agent-profiles.md");

  assert.deepEqual(
    table(markdown, "Name ")
      .map(([name]) => name)
      .sort(),
    Object.keys(bundledAgentProfiles)
      .map((name) => `\`${name}\``)
      .sort(),
  );
  assertMentionsAll(markdown, thinkingLevelSchema.options);
  assertMentionsAll(markdown, compactionProfileSchema.options);
  assert.match(
    markdown,
    new RegExp(`at most ${AGENT_PROFILE_NAME_MAX_LENGTH} characters`),
  );
  assert.match(
    markdown,
    new RegExp(`1–${AGENT_PROFILE_LABEL_MAX_LENGTH} characters`),
  );
  assert.match(
    markdown,
    new RegExp(`1–${AGENT_PROFILE_WHEN_TO_USE_MAX_LENGTH} characters`),
  );
  assert.match(
    markdown,
    new RegExp(`at most ${AGENT_PROFILE_INSTRUCTIONS_MAX_BYTES / 1024} KiB`),
  );
});

void test("launch reference mirrors the run policies", async () => {
  assertMentionsAll(
    await reference("launches.md"),
    launchDefinitionRunPolicySchema.options.map((option) => `"${option}"`),
  );
});
