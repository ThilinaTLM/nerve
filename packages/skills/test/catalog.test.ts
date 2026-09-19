import assert from "node:assert/strict";
import test from "node:test";
import { expectedNerveSkillNames, loadNerveSkills } from "../src/index.js";

test("loads the complete validated built-in Nerve skill catalog", async () => {
  const skills = await loadNerveSkills();

  assert.deepEqual(
    skills.map((skill) => skill.name),
    [...expectedNerveSkillNames],
  );
  assert.equal(new Set(skills.map((skill) => skill.name)).size, skills.length);
  assert.match(skills[0]?.description ?? "", /Create or improve/);
  assert.match(skills[0]?.content ?? "", /Establish the destination/);
  assert.match(skills[0]?.filePath ?? "", /skill-creator[/\\]SKILL\.md$/);
  assert.equal(Object.isFrozen(skills), true);
});

test("reuses the immutable catalog after the first load", async () => {
  assert.equal(await loadNerveSkills(), await loadNerveSkills());
});
