import assert from "node:assert/strict";
import test from "node:test";
import {
  expectedNerveSkillNames,
  loadNerveSkills,
  resolveSkillPlaceholders,
} from "./index.js";

void test("loads the complete validated built-in Nerve skill catalog", async () => {
  const skills = await loadNerveSkills();

  assert.deepEqual(
    skills.map((skill) => skill.name),
    [...expectedNerveSkillNames],
  );
  assert.equal(new Set(skills.map((skill) => skill.name)).size, skills.length);
  const creator = skills.find((skill) => skill.name === "skill-creator");
  assert.match(creator?.description ?? "", /Create or improve/);
  assert.match(creator?.content ?? "", /Establish the destination/);
  assert.match(creator?.filePath ?? "", /skill-creator[/\\]SKILL\.md$/);
  const docs = skills.find((skill) => skill.name === "engineering-docs");
  assert.match(docs?.description ?? "", /^Use when /);
  assert.ok((docs?.description.length ?? Infinity) < 200);
  const extensionCreator = skills.find(
    (skill) => skill.name === "extension-creator",
  );
  assert.match(extensionCreator?.description ?? "", /^Use when /);
  assert.ok((extensionCreator?.description.length ?? Infinity) < 200);
  assert.match(
    extensionCreator?.filePath ?? "",
    /extension-creator[/\\]SKILL\.md$/,
  );
  assert.ok(
    !skills.some((skill) => ["planning", "team-lead"].includes(skill.name)),
  );
  assert.equal(
    resolveSkillPlaceholders("{{skill:skill-creator}}"),
    creator?.filePath,
  );
  assert.equal(Object.isFrozen(skills), true);
});

void test("reuses the immutable catalog after the first load", async () => {
  assert.equal(await loadNerveSkills(), await loadNerveSkills());
});

void test("extension-creator mirrors the limits and runtime API it documents", async () => {
  const { readFile } = await import("node:fs/promises");
  const { dirname, join } = await import("node:path");
  const { agentTextLimits } =
    await import("../core-host/extension-catalog/agent-text-limits.js");
  const skill = (await loadNerveSkills()).find(
    (candidate) => candidate.name === "extension-creator",
  )!;
  const dir = dirname(skill.filePath);
  const manifest = await readFile(
    join(dir, "references", "manifest.md"),
    "utf8",
  );
  for (const limit of Object.values(agentTextLimits))
    assert.ok(
      manifest.includes(limit.toLocaleString("en-US")),
      `references/manifest.md must state the limit ${limit}`,
    );
  // The `extensions` namespace the workflow uses.
  assert.match(skill.content, /extensions\.reload\(/);
  assert.match(skill.content, /extensions\.status\(/);
});
