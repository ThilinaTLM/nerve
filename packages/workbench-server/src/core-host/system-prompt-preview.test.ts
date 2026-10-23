import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { resolveAgentConfiguration } from "@nervekit/contracts/agent-configuration";
import { scopedTurnResources } from "./scoped-turn-resources.js";
import { requireToolDefinition } from "@nervekit/tools/catalog";

void test("turns use captured instructions without consulting their source template, while project context stays fresh", async () => {
  const project = await mkdtemp(join(tmpdir(), "nerve-template-prompt-"));
  try {
    await writeFile(join(project, "AGENTS.md"), "Initial project context");
    const prepare = scopedTurnResources({
      home: project,
      tools: async () => [requireToolDefinition("read")],
      nerveSkills: [],
      agentBrowserSkills: [],
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
