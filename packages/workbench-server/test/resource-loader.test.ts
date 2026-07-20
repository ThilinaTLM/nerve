import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  listAvailableSkills,
  loadHarnessResources,
} from "../src/domains/agents/prompting/resource-loader.js";

function skillContent(name: string, description: string, body: string) {
  return `---\nname: ${name}\ndescription: ${description}\n---\n\n${body}\n`;
}

async function writeSkill(
  root: string,
  directory: string,
  name: string,
  description: string,
  body: string,
) {
  const skillDir = join(root, directory);
  await mkdir(skillDir, { recursive: true });
  const filePath = join(skillDir, "SKILL.md");
  await writeFile(filePath, skillContent(name, description, body), "utf8");
  return filePath;
}

describe("Workbench skill resources", () => {
  it("lists global and project skills separately and preserves project precedence", async () => {
    const root = await mkdtemp(join(tmpdir(), "nerve-resource-loader-"));
    const projectDir = join(root, "project");
    const storageHome = join(root, "storage");
    try {
      await mkdir(projectDir, { recursive: true });
      const projectSkillPath = await writeSkill(
        join(projectDir, ".nerve", "skills"),
        "shared",
        "shared-skill",
        "Project description",
        "Project instructions",
      );
      const globalSkillPath = await writeSkill(
        join(storageHome, "agent", "skills"),
        "shared",
        "shared-skill",
        "Global description",
        "Global instructions",
      );
      await writeSkill(
        join(storageHome, "agent", "skills"),
        "global-only",
        "global-only",
        "Global only description",
        "Global only instructions",
      );

      const available = await listAvailableSkills(projectDir, { storageHome });
      const projectShared = available.projectSkills.find(
        (skill) => skill.name === "shared-skill",
      );
      const globalShared = available.globalSkills.find(
        (skill) => skill.name === "shared-skill",
      );
      assert.equal(projectShared?.filePath, projectSkillPath);
      assert.equal(projectShared?.description, "Project description");
      assert.equal(globalShared?.filePath, globalSkillPath);
      assert.equal(globalShared?.description, "Global description");
      assert.equal("content" in (projectShared ?? {}), false);

      const resources = await loadHarnessResources(projectDir, { storageHome });
      const effectiveShared = resources.skills.filter(
        (skill) => skill.name === "shared-skill",
      );
      assert.equal(effectiveShared.length, 1);
      assert.equal(effectiveShared[0]?.filePath, projectSkillPath);
      assert.equal(
        effectiveShared[0]?.content.includes("Project instructions"),
        true,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("returns only global skills without a project and filters disabled resources without touching files", async () => {
    const root = await mkdtemp(join(tmpdir(), "nerve-resource-loader-"));
    const projectDir = join(root, "project");
    const storageHome = join(root, "storage");
    try {
      await mkdir(projectDir, { recursive: true });
      const filePath = await writeSkill(
        join(storageHome, "agent", "skills"),
        "disable-me",
        "disable-me",
        "Disable me description",
        "Keep these instructions",
      );

      const globalOnly = await listAvailableSkills(undefined, { storageHome });
      assert.deepEqual(globalOnly.projectSkills, []);
      assert.equal(
        globalOnly.globalSkills.some((skill) => skill.name === "disable-me"),
        true,
      );

      const resources = await loadHarnessResources(projectDir, {
        storageHome,
        disabledSkillNames: ["disable-me"],
      });
      assert.equal(
        resources.skills.some((skill) => skill.name === "disable-me"),
        false,
      );
      assert.equal(
        (await readFile(filePath, "utf8")).includes("Keep these instructions"),
        true,
      );
      const stillAvailable = await listAvailableSkills(projectDir, {
        storageHome,
      });
      assert.equal(
        stillAvailable.globalSkills.some(
          (skill) => skill.name === "disable-me",
        ),
        true,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
