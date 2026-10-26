import assert from "node:assert/strict";
import test from "node:test";
import {
  expectedNerveSkillNames,
  loadNerveSkills,
  resolveSkillPlaceholders,
} from "../src/index.js";

test("loads the complete validated built-in Nerve skill catalog", async () => {
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
  assert.ok(
    !skills.some((skill) => ["planning", "team-lead"].includes(skill.name)),
  );
  assert.equal(
    resolveSkillPlaceholders("{{skill:skill-creator}}"),
    creator?.filePath,
  );
  assert.equal(Object.isFrozen(skills), true);
});

test("reuses the immutable catalog after the first load", async () => {
  assert.equal(await loadNerveSkills(), await loadNerveSkills());
});
