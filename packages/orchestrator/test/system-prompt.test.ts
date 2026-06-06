import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import type { AgentRecord } from "@nerve/shared";
import { composeAgentSystemPrompt } from "../src/agent-runner/system-prompt-builder.js";
import {
  activeToolNamesForAgent,
  toolPromptMetadata,
} from "../src/agent-tool-adapter.js";
import { buildNerveSystemPrompt } from "../src/nerve-system-prompt.js";
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
  it("renders active tool summary, context files, skills, date, and cwd", async () => {
    const cwd = await tempProject();
    await writeFile(join(cwd, "AGENTS.md"), "Project rule: prefer tests.\n");
    await mkdir(join(cwd, ".pi", "skills", "review"), { recursive: true });
    await writeFile(
      join(cwd, ".pi", "skills", "review", "SKILL.md"),
      "---\ndescription: Review code carefully.\n---\n\nReview instructions.\n",
    );

    const resources = await loadHarnessResources(cwd);
    const prompt = buildNerveSystemPrompt({
      cwd,
      selectedTools: ["read", "bash", "edit", "write"],
      contextFiles: resources.contextFiles,
      skills: resources.skills,
    });

    assert.match(prompt, /inside Nerve, a coding agent harness/);
    assert.doesNotMatch(prompt, /inside pi, a coding agent harness/);
    assert.match(
      prompt,
      /Tools available in this conversation include: read, bash, edit, write\./,
    );
    assert.match(prompt, /API-provided tool schemas/);
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
    assert.doesNotMatch(prompt, /process_start/);
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
          filePath: "/tmp/project/.pi/skills/hidden/SKILL.md",
        },
      ],
    });

    assert.doesNotMatch(prompt, /<available_skills>/);
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
    assert.match(prompt, /\[PLAN MODE ACTIVE\]/);
    assert.match(
      prompt,
      /WRITE and EDIT only plan files inside \/tmp\/nerve\/plans\//,
    );
    assert.match(prompt, /plan_mode_present using the plan file path/);
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
