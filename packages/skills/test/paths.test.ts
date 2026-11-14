import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import test from "node:test";
import {
  builtinSkillFilePath,
  resolveSkillPlaceholders,
} from "../src/index.js";

test("resolves bundled skills but rejects unknown names and traversal", () => {
  for (const name of ["engineering-docs", "skill-creator"]) {
    const path = builtinSkillFilePath(name);
    assert.ok(path);
    assert.ok(isAbsolute(path));
    assert.ok(existsSync(path));
    assert.ok(path.endsWith(`/${name}/SKILL.md`));
  }
  for (const name of [
    "unknown",
    "planning",
    "team-lead",
    "../skill-creator",
    "",
    "/tmp/skill-creator",
    "jira",
    "confluence",
  ]) {
    assert.equal(builtinSkillFilePath(name), undefined);
  }
});

test("bundles supporting files beside a built-in skill", () => {
  const root = dirname(builtinSkillFilePath("engineering-docs") ?? "");
  for (const file of [
    "reference/architecture.md",
    "reference/proposals.md",
    "scripts/doccheck.mjs",
  ]) {
    assert.ok(existsSync(join(root, file)), file);
  }
});

test("replaces every known placeholder without adding quotes and preserves unknown ones", () => {
  assert.equal(
    resolveSkillPlaceholders(
      "Read {{skill:engineering-docs}}, {{skill:skill-creator}}, {{skill:engineering-docs}}; {{skill:unknown}}.",
    ),
    `Read ${builtinSkillFilePath("engineering-docs")}, ${builtinSkillFilePath("skill-creator")}, ${builtinSkillFilePath("engineering-docs")}; {{skill:unknown}}.`,
  );
});
