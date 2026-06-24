import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import type { AgentRecord } from "@nerve/shared";
import { composeAgentSystemPrompt } from "../src/domains/agents/run/system-prompt-builder.js";
import {
  activeToolNamesForAgent,
  toolPromptMetadata,
} from "../src/domains/tools/agent-tool-adapter.js";
import { buildNerveSystemPrompt } from "../src/nerve-system-prompt.js";
import { promptText } from "../src/prompt-text.js";
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

describe("Nerve system prompt", () => {
  it("formats readable prompt template strings without source indentation", () => {
    const bullets = "- first\n- second";

    assert.equal(
      promptText`
        Heading:
        ${bullets}
      `,
      "Heading:\n- first\n- second",
    );
  });

  it("renders active tool summary, context files, skills, date, and cwd", async () => {
    const cwd = await tempProject();
    const storageHome = await tempProject();
    await writeFile(join(cwd, "AGENTS.md"), "Project rule: prefer tests.\n");
    await mkdir(join(cwd, ".nerve", "skills", "review"), {
      recursive: true,
    });
    await writeFile(
      join(cwd, ".nerve", "skills", "review", "SKILL.md"),
      "---\ndescription: Review code carefully.\n---\n\nReview instructions.\n",
    );

    const resources = await loadHarnessResources(cwd, { storageHome });
    const prompt = buildNerveSystemPrompt({
      cwd,
      selectedTools: ["read", "bash", "edit", "write"],
      contextFiles: resources.contextFiles,
      skills: resources.skills,
    });

    assert.match(prompt, /^You are an expert coding assistant/);
    assert.match(prompt, /inside Nerve, a coding agent harness/);
    assert.doesNotMatch(prompt, /inside pi, a coding agent harness/);
    assert.match(
      prompt,
      /Tools available in this conversation include: read, bash, edit, write\./,
    );
    assert.match(prompt, /API-provided tool schemas/);
    assert.match(prompt, /^Guidelines:\n- /m);
    assert.doesNotMatch(prompt, /^ +Guidelines:/m);
    assert.doesNotMatch(prompt, /Available tools:\n- read:/);
    assert.doesNotMatch(prompt, /<project_context>/);
    assert.match(prompt, /<project_instructions path=".*AGENTS\.md">/);
    assert.match(prompt, /Project rule: prefer tests\./);
    assert.match(prompt, /<available_skills>/);
    assert.match(prompt, /<name>review<\/name>/);
    assert.match(prompt, /<description>Review code carefully\.<\/description>/);
    assert.match(prompt, /Current date: \d{4}-\d{2}-\d{2}/);
    assert.ok(prompt.endsWith(`Current working directory: ${cwd}`));
  });

  it("uses only active tools in the concise tool summary", () => {
    const prompt = buildNerveSystemPrompt({
      cwd: "/tmp/project",
      selectedTools: ["read", "grep"],
    });

    assert.match(
      prompt,
      /Tools available in this conversation include: read, grep\./,
    );
    assert.doesNotMatch(prompt, /write/);
    assert.doesNotMatch(prompt, /task_start/);
  });

  it("prefers dedicated file tools over bash file-operation guidance", () => {
    const agent = testAgent();
    const activeToolNames = activeToolNamesForAgent(agent);
    const prompt = composeAgentSystemPrompt(
      agent,
      activeToolNames,
      toolPromptMetadata(activeToolNames),
      { contextFiles: [], skills: [] },
    );

    assert.match(prompt, /Use dedicated file tools when available:/);
    assert.match(prompt, /Use bash for finite commands/);
    assert.match(prompt, /Use bash for finite tests\/checks\/builds/);
    assert.doesNotMatch(
      prompt,
      /Use bash for file operations like ls, rg, find/,
    );
    assert.doesNotMatch(
      prompt,
      /Use bash for file listing\/search only when dedicated grep\/find\/ls tools are unavailable/,
    );
  });

  it("falls back to bash file listing/search guidance when dedicated tools are unavailable", () => {
    const prompt = buildNerveSystemPrompt({
      cwd: "/tmp/project",
      selectedTools: ["bash"],
    });

    assert.match(
      prompt,
      /Use bash for file listing\/search only when dedicated grep\/find\/ls tools are unavailable\./,
    );
    assert.doesNotMatch(
      prompt,
      /Use bash for file operations like ls, rg, find/,
    );
  });

  it("omits skills when read is not active", async () => {
    const prompt = buildNerveSystemPrompt({
      cwd: "/tmp/project",
      selectedTools: ["bash"],
      skills: [
        {
          name: "hidden",
          description: "Hidden without read.",
          content: "content",
          filePath: "/tmp/project/.nerve/skills/hidden/SKILL.md",
        },
      ],
    });

    assert.doesNotMatch(prompt, /<available_skills>/);
  });

  it("does not load legacy .pi project resources", async () => {
    const cwd = await tempProject();
    const storageHome = await tempProject();
    await mkdir(join(cwd, ".pi", "skills", "legacy-pi-skill"), {
      recursive: true,
    });
    await writeFile(
      join(cwd, ".pi", "skills", "legacy-pi-skill", "SKILL.md"),
      "---\ndescription: Legacy Pi skill.\n---\n\nDo not load.\n",
    );
    await writeFile(join(cwd, ".pi", "SYSTEM.md"), "Legacy system prompt.\n");
    await writeFile(
      join(cwd, ".pi", "APPEND_SYSTEM.md"),
      "Legacy append prompt.\n",
    );

    const resources = await loadHarnessResources(cwd, { storageHome });

    assert.equal(resources.systemPrompt, undefined);
    assert.equal(resources.appendSystemPrompt, undefined);
    assert.equal(
      resources.skills.some((skill) => skill.name === "legacy-pi-skill"),
      false,
    );
  });

  it("loads global Nerve agent resources from storage home", async () => {
    const cwd = await tempProject();
    const storageHome = await tempProject();
    const agentDir = join(storageHome, "agent");
    await mkdir(join(agentDir, "skills", "global-nerve-skill"), {
      recursive: true,
    });
    await writeFile(join(agentDir, "AGENTS.md"), "Global Nerve rule.\n");
    await writeFile(join(agentDir, "SYSTEM.md"), "Global system prompt.\n");
    await writeFile(
      join(agentDir, "skills", "global-nerve-skill", "SKILL.md"),
      "---\ndescription: Global Nerve skill.\n---\n\nUse global instructions.\n",
    );

    const resources = await loadHarnessResources(cwd, { storageHome });

    assert.deepEqual(resources.contextFiles[0], {
      path: join(agentDir, "AGENTS.md"),
      content: "Global Nerve rule.\n",
    });
    assert.equal(resources.systemPrompt, "Global system prompt.\n");
    assert.ok(
      resources.skills.some(
        (skill) =>
          skill.name === "global-nerve-skill" &&
          skill.description === "Global Nerve skill.",
      ),
    );
  });

  it("prefers project .nerve skills over project .agents skills", async () => {
    const cwd = await tempProject();
    const storageHome = await tempProject();
    await mkdir(join(cwd, ".nerve", "skills", "collision-skill"), {
      recursive: true,
    });
    await mkdir(join(cwd, ".agents", "skills", "collision-skill"), {
      recursive: true,
    });
    await writeFile(
      join(cwd, ".nerve", "skills", "collision-skill", "SKILL.md"),
      "---\ndescription: Nerve project skill.\n---\n\nUse Nerve.\n",
    );
    await writeFile(
      join(cwd, ".agents", "skills", "collision-skill", "SKILL.md"),
      "---\ndescription: Agents project skill.\n---\n\nUse agents.\n",
    );

    const resources = await loadHarnessResources(cwd, { storageHome });
    const skill = resources.skills.find(
      (candidate) => candidate.name === "collision-skill",
    );

    assert.equal(skill?.description, "Nerve project skill.");
  });

  it("adds full plan-mode instructions, including for custom prompts", () => {
    const prompt = buildNerveSystemPrompt({
      cwd: "/tmp/project",
      mode: "planning",
      selectedTools: ["read", "bash", "edit", "write", "plan_mode_present"],
      customPrompt: "Custom base prompt.",
      planDir: "/tmp/nerve/plans",
    });

    assert.match(prompt, /Custom base prompt\./);
    assert.match(prompt, /^\[PLAN MODE ACTIVE\]$/m);
    assert.doesNotMatch(prompt, /^ +\[PLAN MODE ACTIVE\]/m);
    assert.match(
      prompt,
      /WRITE and EDIT only plan files inside \/tmp\/nerve\/plans\//,
    );
    assert.match(prompt, /plan_mode_present using the plan file path/);
    assert.match(prompt, /^Restrictions:\n- Use read-only/m);
    assert.match(prompt, /^## Workflow\n\n1\. Understand/m);
    assert.doesNotMatch(prompt, /plan_write/);
  });

  it("exposes web tools to coding/planning agents but not read-only agents", () => {
    assert.ok(activeToolNamesForAgent(testAgent()).includes("web_search"));
    assert.ok(activeToolNamesForAgent(testAgent()).includes("web_fetch"));
    assert.ok(
      activeToolNamesForAgent(testAgent({ mode: "planning" })).includes(
        "web_search",
      ),
    );
    assert.ok(
      !activeToolNamesForAgent(
        testAgent({ permissionLevel: "read_only" }),
      ).includes("web_search"),
    );
  });

  it("does not expose orchestration metadata", () => {
    const agent = testAgent();
    const activeToolNames = activeToolNamesForAgent(agent);
    const prompt = composeAgentSystemPrompt(
      agent,
      activeToolNames,
      toolPromptMetadata(activeToolNames),
      { contextFiles: [], skills: [] },
    );

    assert.doesNotMatch(prompt, /Nerve orchestration context:/);
    assert.doesNotMatch(prompt, /Root agent:/);
    assert.doesNotMatch(prompt, /Child budget:/);
    assert.doesNotMatch(prompt, /Permission level:/);
  });
});

function testAgent(overrides: Partial<AgentRecord> = {}): AgentRecord {
  return {
    id: "agent_01HN0000000000000000000000",
    conversationId: "conv_01HN0000000000000000000000",
    projectId: "proj_01HN0000000000000000000000",
    projectDir: "/tmp/project",
    workerId: "worker_01HN0000000000000000000000",
    rootAgentId: "agent_01HN0000000000000000000000",
    mode: "coding",
    permissionLevel: "autonomous",
    workspaceScope: { roots: ["/tmp/project"] },
    budget: { depth: 0, maxDepth: 3, maxRuns: 8, usedRuns: 0 },
    status: "idle",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}
