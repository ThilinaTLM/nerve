import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { loadHarnessResources } from "./resource-loader.js";

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "nerve-project-resources-"));
  const projectDir = join(root, "project");
  const home = join(root, "home");
  const nested = join(projectDir, "packages", "app");
  const write = async (path: string, text: string) => {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, text);
  };
  await mkdir(nested, { recursive: true });
  return {
    root,
    home,
    projectDir,
    nested,
    write,
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}

void test("prompt files are project-bounded, follow working-directory ancestry, and never load SYSTEM or user prompts", async () => {
  const { root, home, projectDir, nested, write, cleanup } = await fixture();
  try {
    await write(join(root, "AGENTS.md"), "Above project");
    await write(join(home, "agent", "AGENTS.md"), "User context");
    await write(join(home, "agent", "SYSTEM.md"), "User system");
    await write(join(home, "agent", "APPEND_SYSTEM.md"), "User append");
    await write(join(projectDir, "AGENTS.md"), "Root instructions");
    await write(
      join(projectDir, "packages", "AGENTS.md"),
      "Package instructions",
    );
    await write(join(nested, "AGENTS.md"), "Working instructions");
    await write(
      join(projectDir, "sibling", "AGENTS.md"),
      "Unrelated instructions",
    );
    await write(join(projectDir, ".nerve", "SYSTEM.md"), "Project system");
    await write(
      join(projectDir, ".nerve", "APPEND_SYSTEM.md"),
      "Project append",
    );
    await write(join(nested, ".nerve", "APPEND_SYSTEM.md"), "Nested append");
    const options = { projectDir, storageHome: home };
    const atRoot = await loadHarnessResources(projectDir, options);
    assert.deepEqual(
      atRoot.contextFiles.map((file) => file.content),
      ["Root instructions"],
    );
    const resources = await loadHarnessResources(nested, options);
    assert.deepEqual(
      resources.contextFiles.map((file) => file.content),
      ["Root instructions", "Package instructions", "Working instructions"],
    );
    assert.equal(resources.appendSystemPrompt, "Project append");
    assert.ok(!("systemPrompt" in resources));
    const outside = await loadHarnessResources(root, options);
    assert.deepEqual(
      outside.contextFiles.map((file) => file.content),
      ["Root instructions"],
    );
    assert.equal(outside.appendSystemPrompt, "Project append");
  } finally {
    await cleanup();
  }
});

void test("removing user prompt files does not remove user or project skills", async () => {
  const { home, projectDir, nested, write, cleanup } = await fixture();
  try {
    const skill = (name: string) =>
      `---\nname: ${name}\ndescription: ${name} guidance\n---\nRead this skill.\n`;
    await write(
      join(home, "agent", "skills", "user-resource", "SKILL.md"),
      skill("user-resource"),
    );
    await write(
      join(projectDir, ".nerve", "skills", "project-resource", "SKILL.md"),
      skill("project-resource"),
    );
    const resources = await loadHarnessResources(nested, {
      projectDir,
      storageHome: home,
    });
    const names = resources.skills.map((skill) => skill.name);
    assert.ok(names.includes("user-resource"));
    assert.ok(names.includes("project-resource"));
    assert.deepEqual(resources.contextFiles, []);
    assert.equal(resources.appendSystemPrompt, undefined);
    const captured = await loadHarnessResources(nested, {
      projectDir,
      storageHome: home,
      enabledFileSkillNames: ["project-resource"],
    });
    assert.deepEqual(
      captured.skills.map((skill) => skill.name),
      ["project-resource"],
    );
  } finally {
    await cleanup();
  }
});
