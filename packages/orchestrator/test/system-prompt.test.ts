import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { buildPiSystemPrompt } from "../src/pi-system-prompt.js";
import { loadHarnessResources } from "../src/resource-loader.js";

const roots: string[] = [];

after(async () => {
  await Promise.all(
    roots.map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function tempProject(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "nerve-prompt-"));
  roots.push(root);
  return root;
}

describe("Pi-compatible system prompt", () => {
  it("renders active tools, context files, skills, date, and cwd", async () => {
    const cwd = await tempProject();
    await writeFile(join(cwd, "AGENTS.md"), "Project rule: prefer tests.\n");
    await mkdir(join(cwd, ".pi", "skills", "review"), { recursive: true });
    await writeFile(
      join(cwd, ".pi", "skills", "review", "SKILL.md"),
      "---\ndescription: Review code carefully.\n---\n\nReview instructions.\n",
    );

    const resources = await loadHarnessResources(cwd);
    const prompt = buildPiSystemPrompt({
      cwd,
      selectedTools: ["read", "bash", "edit", "write"],
      toolSnippets: {
        read: "Read file contents",
        bash: "Execute bash commands",
        edit: "Edit files",
        write: "Create or overwrite files",
      },
      contextFiles: resources.contextFiles,
      skills: resources.skills,
    });

    assert.match(prompt, /Available tools:\n- read: Read file contents/);
    assert.match(prompt, /<project_context>/);
    assert.match(prompt, /Project rule: prefer tests\./);
    assert.match(prompt, /<available_skills>/);
    assert.match(prompt, /<name>review<\/name>/);
    assert.match(prompt, /Current date: \d{4}-\d{2}-\d{2}/);
    assert.ok(prompt.endsWith(`Current working directory: ${cwd}`));
  });

  it("omits skills when read is not active", async () => {
    const prompt = buildPiSystemPrompt({
      cwd: "/tmp/project",
      selectedTools: ["bash"],
      toolSnippets: { bash: "Execute bash commands" },
      skills: [
        {
          name: "hidden",
          description: "Hidden without read.",
          content: "content",
          filePath: "/tmp/project/.pi/skills/hidden/SKILL.md",
        },
      ],
    });

    assert.doesNotMatch(prompt, /<available_skills>/);
  });
});
