import assert from "node:assert/strict";
import test from "node:test";
import type { AvailableSkill } from "@nervekit/contracts/skills";
import { projectGuides } from "./project-guides";

const skill = (
  name: string,
  patch: Partial<AvailableSkill> = {},
): AvailableSkill => ({
  name,
  description: "",
  filePath: `/p/.nerve/skills/${name}/SKILL.md`,
  source: "project",
  ...patch,
});

test("the skills guide names the project's skills and its pending ones", () => {
  const guides = projectGuides({
    projectName: "shop",
    skills: [
      skill("a"),
      skill("b", { approval: "pending" }),
      skill("c", { source: "user" }),
    ],
    pending: {},
  });
  assert.equal(guides.skills?.title, "shop · 2 project skills");
  assert.equal(guides.skills?.problem, "1 is waiting for your review");
  assert.equal(guides.skills?.summary, undefined);
  assert.equal(guides.skills?.pageId, "skills");
});

test("no guide when the project has nothing there", () => {
  assert.deepEqual(
    projectGuides({
      projectName: "shop",
      skills: [skill("u", { source: "user" })],
      projectExtensions: 0,
      pending: {},
    }),
    {},
  );
});

test("extensions and other pages show when the project has some or something needs the user", () => {
  const guides = projectGuides({
    projectName: "shop",
    projectExtensions: 2,
    pending: { extensions: 1, suggestions: 2 },
  });
  assert.equal(guides.extensions?.problem, "1 needs your attention");
  assert.equal(guides.suggestions?.problem, "2 need your attention");
  assert.equal(guides.agents, undefined);
  assert.equal(
    projectGuides({ projectName: "shop", projectExtensions: 2, pending: {} })
      .extensions?.problem,
    undefined,
  );
});
