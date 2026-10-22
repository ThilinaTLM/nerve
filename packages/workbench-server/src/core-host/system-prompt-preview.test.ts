import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { defaultSettings } from "@nervekit/contracts/settings";
import { userCapabilitySelection } from "./user-capability-selection.js";
import { createTurnResourcesPort } from "./turn-resources.adapter.js";
import { requireToolDefinition } from "@nervekit/tools/catalog";

void test("turns use captured instructions without consulting their source template, while project context stays fresh", async () => {
  const project = await mkdtemp(join(tmpdir(), "nerve-template-prompt-"));
  try {
    await writeFile(join(project, "AGENTS.md"), "Initial project context");
    const port = createTurnResourcesPort({
      home: project,
      tools: () => [requireToolDefinition("read")],
      skillCatalogs: { nerve: { skills: [] }, agentBrowser: { skills: [] } },
      hasExistingSubagents: () => false,
      capabilities: {
        configuration: async () => ({
          effective: userCapabilitySelection(defaultSettings),
          availableTools: [],
          toolProfileOptions: { jira: [], confluence: [], web_search: [] },
        }),
      } as never,
      agentProfiles: {
        list: async () => {
          throw new Error("Never resolve live profile instructions");
        },
        usable: async () => {
          throw new Error("No delegation tool");
        },
        preview: async () => {
          throw new Error("No profile preview required");
        },
      },
    });
    const input = {
      conversation: { id: "c", projectId: "p", parentConversationId: null },
      projectDir: project,
      config: {
        model: { provider: "test", modelId: "model" },
        reasoningLevel: "off" as const,
        permissionRuleSetId: "baseline",
        agentProfile: "deleted-profile",
        systemPrompt: null,
        instructions: null,
        workingDirectory: project,
      },
      appliedAgentProfile: {
        schemaVersion: 1 as const,
        name: "deleted-profile",
        instructions: "Captured profile rules",
        locked: {},
      },
    };
    const first = await port.prepare(input);
    assert.match(first.systemPrompt, /Captured profile rules/);
    assert.match(first.systemPrompt, /Initial project context/);
    await writeFile(join(project, "AGENTS.md"), "Fresh project context");
    const next = await port.prepare(input);
    assert.match(next.systemPrompt, /Captured profile rules/);
    assert.match(next.systemPrompt, /Fresh project context/);
    assert.doesNotMatch(next.systemPrompt, /Initial project context/);
  } finally {
    await rm(project, { recursive: true, force: true });
  }
});
