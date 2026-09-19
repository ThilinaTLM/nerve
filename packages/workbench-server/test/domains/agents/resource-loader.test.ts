import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  listAvailableSkills,
  loadHarnessResources,
} from "../../../src/domains/agents/prompting/resource-loader.js";

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
  const nerveSkillCreator = {
    name: "skill-creator",
    description: "Create Nerve skills",
    content: "Nerve skill creator instructions",
    filePath: "/tmp/nerve-skills/skill-creator/SKILL.md",
  };
  const agentBrowserCore = {
    name: "core",
    description: "Agent Browser core description",
    content: "Agent Browser core instructions",
    filePath: "/tmp/agent-browser/core/SKILL.md",
  };

  it("tags user and project skills by source and preserves project precedence", async () => {
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
      const projectShared = available.skills.find(
        (skill) => skill.name === "shared-skill" && skill.source === "project",
      );
      const globalShared = available.skills.find(
        (skill) => skill.name === "shared-skill" && skill.source === "user",
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

  it("lists built-in Nerve skills but keeps them out of resources by default", async () => {
    const root = await mkdtemp(join(tmpdir(), "nerve-resource-loader-"));
    const projectDir = join(root, "project");
    try {
      await mkdir(projectDir, { recursive: true });
      const available = await listAvailableSkills(projectDir, {
        nerveSkills: [nerveSkillCreator],
      });
      assert.deepEqual(
        available.skills.filter((skill) => skill.source === "nerve"),
        [
          {
            name: "skill-creator",
            description: "Create Nerve skills",
            filePath: nerveSkillCreator.filePath,
            source: "nerve",
          },
        ],
      );

      const disabled = await loadHarnessResources(projectDir, {
        nerveSkills: [nerveSkillCreator],
      });
      assert.equal(
        disabled.skills.some((skill) => skill.name === "skill-creator"),
        false,
      );

      const enabled = await loadHarnessResources(projectDir, {
        nerveSkills: [nerveSkillCreator],
        enabledNerveSkillNames: ["skill-creator"],
      });
      assert.equal(
        enabled.skills.find((skill) => skill.name === "skill-creator")
          ?.filePath,
        nerveSkillCreator.filePath,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("keeps file precedence over Nerve skills and allows disabled-file fallback", async () => {
    const root = await mkdtemp(join(tmpdir(), "nerve-resource-loader-"));
    const projectDir = join(root, "project");
    try {
      await mkdir(projectDir, { recursive: true });
      const projectPath = await writeSkill(
        join(projectDir, ".nerve", "skills"),
        "skill-creator",
        "skill-creator",
        "Project skill creator",
        "Project instructions",
      );
      const projectWins = await loadHarnessResources(projectDir, {
        nerveSkills: [nerveSkillCreator],
        enabledNerveSkillNames: ["skill-creator"],
      });
      assert.equal(
        projectWins.skills.find((skill) => skill.name === "skill-creator")
          ?.filePath,
        projectPath,
      );

      const nerveFallback = await loadHarnessResources(projectDir, {
        disabledSkillNames: ["skill-creator"],
        nerveSkills: [nerveSkillCreator],
        enabledNerveSkillNames: ["skill-creator"],
      });
      assert.equal(
        nerveFallback.skills.find((skill) => skill.name === "skill-creator")
          ?.filePath,
        nerveSkillCreator.filePath,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("tags Agent Browser skills and keeps them opt-in with file precedence", async () => {
    const root = await mkdtemp(join(tmpdir(), "nerve-resource-loader-"));
    const projectDir = join(root, "project");
    try {
      await mkdir(projectDir, { recursive: true });
      const projectCorePath = await writeSkill(
        join(projectDir, ".nerve", "skills"),
        "core",
        "core",
        "Project core description",
        "Project core instructions",
      );

      const available = await listAvailableSkills(projectDir, {
        agentBrowserSkills: [agentBrowserCore],
      });
      assert.deepEqual(
        available.skills.filter((skill) => skill.source === "agentBrowser"),
        [
          {
            name: "core",
            description: "Agent Browser core description",
            filePath: agentBrowserCore.filePath,
            source: "agentBrowser",
          },
        ],
      );

      const defaultResources = await loadHarnessResources(projectDir, {
        agentBrowserSkills: [agentBrowserCore],
      });
      assert.equal(
        defaultResources.skills.some(
          (skill) => skill.filePath === agentBrowserCore.filePath,
        ),
        false,
      );

      const projectWins = await loadHarnessResources(projectDir, {
        agentBrowserSkills: [agentBrowserCore],
        enabledAgentBrowserSkillNames: ["core"],
      });
      const projectCoreSkills = projectWins.skills.filter(
        (skill) => skill.name === "core",
      );
      assert.equal(projectCoreSkills.length, 1);
      assert.equal(projectCoreSkills[0]?.filePath, projectCorePath);

      const builtinFallback = await loadHarnessResources(projectDir, {
        disabledSkillNames: ["core"],
        agentBrowserSkills: [agentBrowserCore],
        enabledAgentBrowserSkillNames: ["core"],
      });
      const fallbackCoreSkills = builtinFallback.skills.filter(
        (skill) => skill.name === "core",
      );
      assert.equal(fallbackCoreSkills.length, 1);
      assert.equal(fallbackCoreSkills[0]?.filePath, agentBrowserCore.filePath);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("returns only user skills without a project and filters disabled resources without touching files", async () => {
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
      assert.deepEqual(
        globalOnly.skills.filter((skill) => skill.source === "project"),
        [],
      );
      assert.equal(
        globalOnly.skills.some(
          (skill) => skill.name === "disable-me" && skill.source === "user",
        ),
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
        stillAvailable.skills.some(
          (skill) => skill.name === "disable-me" && skill.source === "user",
        ),
        true,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
