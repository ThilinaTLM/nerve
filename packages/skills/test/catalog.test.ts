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
  const creator = skills.find((skill) => skill.name === "skill-creator");
  assert.match(creator?.description ?? "", /Create or improve/);
  assert.match(creator?.content ?? "", /Establish the destination/);
  assert.match(creator?.filePath ?? "", /skill-creator[/\\]SKILL\.md$/);
  const richdoc = skills.find((skill) => skill.name === "richdoc");
  assert.match(richdoc?.description ?? "", /browser-readable HTML/);
  assert.match(richdoc?.content ?? "", /scripts\/richdoc\.mjs/);
  assert.equal(Object.isFrozen(skills), true);
});

test("reuses the immutable catalog after the first load", async () => {
  assert.equal(await loadNerveSkills(), await loadNerveSkills());
});
