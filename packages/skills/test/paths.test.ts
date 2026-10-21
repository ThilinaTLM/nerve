import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { isAbsolute } from "node:path";
import test from "node:test";
import {
  builtinSkillFilePath,
  loadNerveSkills,
  resolveSkillPlaceholders,
} from "../src/index.js";

test("resolves bundled skills and guides but rejects unknown names and traversal", () => {
  for (const name of ["team-lead", "skill-creator", "jira", "confluence"]) {
    const path = builtinSkillFilePath(name);
    assert.ok(path);
    assert.ok(isAbsolute(path));
    assert.ok(existsSync(path));
    assert.ok(path.endsWith(`/${name}/SKILL.md`));
  }
  for (const name of ["unknown", "../jira", "", "/tmp/jira", "guides/jira"]) {
    assert.equal(builtinSkillFilePath(name), undefined);
  }
});

test("replaces every known placeholder without adding quotes and preserves unknown ones", () => {
  assert.equal(
    resolveSkillPlaceholders(
      "Read {{skill:jira}}, {{skill:team-lead}}, {{skill:jira}}; {{skill:unknown}}.",
    ),
    `Read ${builtinSkillFilePath("jira")}, ${builtinSkillFilePath("team-lead")}, ${builtinSkillFilePath("jira")}; {{skill:unknown}}.`,
  );
});

test("guide skills are not exposed in the normal skill catalog", async () => {
  const names = (await loadNerveSkills()).map((skill) => skill.name);
  assert.ok(!names.includes("jira"));
  assert.ok(!names.includes("confluence"));
});
