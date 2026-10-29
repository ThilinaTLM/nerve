import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { resolveAgentConfiguration } from "@nervekit/contracts/agent-configuration";
import { scopedTurnResources } from "./scoped-turn-resources.js";
import { requireToolDefinition } from "@nervekit/tools/catalog";
import type { Skill } from "@nervekit/harness/resources";

void test("turns use captured instructions without consulting their source template, while project context stays fresh", async () => {
  const project = await mkdtemp(join(tmpdir(), "nerve-template-prompt-"));
  try {
    await writeFile(join(project, "AGENTS.md"), "Initial project context");
    const prepare = scopedTurnResources({
      home: project,
      tools: async () => [requireToolDefinition("read")],
      nerveSkills: () => [],
      agentBrowserSkills: () => [],
      hasChildren: () => false,
      service: {
        profiles: {
          get: async () => {
            throw new Error(
              "Never resolve mutable profile instructions on a turn",
            );
          },
        },
      } as never,
    });
    const settings = resolveAgentConfiguration({ role: "lead" }).settings;
    const input = {
      conversation: { id: "c", projectId: "p", parentConversationId: null },
      projectDir: project,
      coreTools: [],
      config: {
        model: { provider: "test", modelId: "model" },
        reasoningLevel: "off" as const,
        permissionRuleSetId: "baseline",
        agentProfile: "deleted-profile",
        systemPrompt: null,
        instructions: null,
        workingDirectory: project,
      },
    };
    const first = await prepare(input, settings, "Captured profile rules");
    assert.match(first.systemPrompt, /Captured profile rules/);
    assert.match(first.systemPrompt, /Initial project context/);
    await writeFile(join(project, "AGENTS.md"), "Fresh project context");
    const next = await prepare(input, settings, "Captured profile rules");
    assert.match(next.systemPrompt, /Captured profile rules/);
    assert.match(next.systemPrompt, /Fresh project context/);
    assert.doesNotMatch(next.systemPrompt, /Initial project context/);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});

void test("prompt preparation reads initialized and subsequently replaced skill catalogs", async () => {
  const project = await mkdtemp(join(tmpdir(), "nerve-catalog-prompt-"));
  try {
    let nerveSkills: Skill[] = [];
    let browserSkills: Skill[] = [];
    const prepare = scopedTurnResources({
      home: project,
      tools: async () => [requireToolDefinition("read")],
      nerveSkills: () => nerveSkills,
      agentBrowserSkills: () => browserSkills,
      hasChildren: () => false,
      service: {} as never,
    });
    const skill = (name: string, filePath: string): Skill => ({
      name,
      description: `${name} guidance`,
      filePath,
      content: "Instructions",
      disableModelInvocation: false,
    });
    const input = {
      conversation: { id: "c", projectId: "p", parentConversationId: null },
      projectDir: project,
      coreTools: [],
      config: {
        model: { provider: "test", modelId: "model" },
        reasoningLevel: "off" as const,
        permissionRuleSetId: "baseline",
        agentProfile: "coding",
        systemPrompt: null,
        instructions: null,
        workingDirectory: project,
      },
    };
    const settings = resolveAgentConfiguration({
      role: "lead",
      conversation: {
        skills: {
          nerve: { "enabled-nerve": true, "disabled-nerve": false },
          agentBrowser: { "enabled-browser": true, "disabled-browser": false },
        },
      },
    }).settings;
    // Composition precedes asynchronous catalog initialization at startup.
    nerveSkills = [
      skill("enabled-nerve", "/nerve/initial/SKILL.md"),
      skill("disabled-nerve", "/nerve/disabled/SKILL.md"),
    ];
    browserSkills = [
      skill("enabled-browser", "/browser/initial/SKILL.md"),
      skill("disabled-browser", "/browser/disabled/SKILL.md"),
    ];
    const first = await prepare(input, settings, "");
    assert.match(first.systemPrompt, /<available_skills>/);
    assert.match(first.systemPrompt, /- enabled-nerve:/);
    assert.match(first.systemPrompt, /- enabled-browser:/);
    assert.match(first.systemPrompt, /path: \/nerve\/initial\/SKILL.md/);
    assert.match(first.systemPrompt, /path: \/browser\/initial\/SKILL.md/);
    assert.doesNotMatch(first.systemPrompt, /disabled-nerve|disabled-browser/);

    nerveSkills = [skill("enabled-nerve", "/nerve/refreshed/SKILL.md")];
    browserSkills = [skill("enabled-browser", "/browser/refreshed/SKILL.md")];
    const next = await prepare(input, settings, "");
    assert.match(next.systemPrompt, /path: \/nerve\/refreshed\/SKILL.md/);
    assert.match(next.systemPrompt, /path: \/browser\/refreshed\/SKILL.md/);
    assert.doesNotMatch(next.systemPrompt, /initial\/SKILL.md/);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});
