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
  const configure = skills.find((skill) => skill.name === "configure-nerve");
  assert.match(configure?.description ?? "", /^Use when /);
  assert.match(configure?.filePath ?? "", /configure-nerve[/\\]SKILL\.md$/);
  const docs = skills.find((skill) => skill.name === "engineering-docs");
  assert.match(docs?.description ?? "", /^Use when /);
  assert.ok((docs?.description.length ?? Infinity) < 200);
  assert.ok(
    !skills.some((skill) => ["planning", "team-lead"].includes(skill.name)),
  );
  assert.equal(
    resolveSkillPlaceholders("{{skill:configure-nerve}}"),
    configure?.filePath,
  );
  assert.equal(Object.isFrozen(skills), true);
});

void test("reuses the immutable catalog after the first load", async () => {
  assert.equal(await loadNerveSkills(), await loadNerveSkills());
});

void test("configure-nerve extension reference mirrors the limits and runtime API it documents", async () => {
  const { readFile } = await import("node:fs/promises");
  const { dirname, join } = await import("node:path");
  const { agentTextLimits } =
    await import("../core-host/extensions/extension-catalog/agent-text-limits.js");
  const skill = (await loadNerveSkills()).find(
    (candidate) => candidate.name === "configure-nerve",
  )!;
  const dir = dirname(skill.filePath);
  const manifest = await readFile(
    join(dir, "reference", "extensions", "manifest.md"),
    "utf8",
  );
  for (const limit of Object.values(agentTextLimits))
    assert.ok(
      manifest.includes(limit.toLocaleString("en-US")),
      `reference/extensions/manifest.md must state the limit ${limit}`,
    );
  // The `extensions` namespace the workflow uses.
  const guide = await readFile(join(dir, "guide", "extensions.md"), "utf8");
  assert.match(guide, /extensions\.reload\(/);
  assert.match(guide, /extensions\.status\(/);
});
