import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type {
  Conversation,
  ConversationConfig,
} from "@nervekit/contracts/core";
import {
  toolDefinitionByName,
  type ToolDefinition,
} from "@nervekit/tools/catalog";
import {
  createTurnResourcesPort,
  withSubagentProfiles,
} from "./turn-resources.adapter.js";
import { buildNerveSystemPrompt } from "./nerve-system-prompt.js";

const tool = (name: string) => toolDefinitionByName(name) as ToolDefinition;
const coreTools = [
  "subagent_prompt",
  "subagent_status",
  "subagent_stop",
  "ask_user",
  "plan_mode_present",
].map(tool);

async function prepare(options: {
  parent: string | null;
  usable: { name: string; description: string }[];
  instructions?: string | null;
}) {
  const home = await mkdtemp(join(tmpdir(), "nerve-turn-"));
  try {
    const port = createTurnResourcesPort({
      home,
      tools: () => [tool("read")],
      skills: [],
      agentBrowserSkills: [],
      capabilities: {
        configuration: async () => ({
          effective: { disabledTools: [], toolProfiles: {} },
          availableTools: [
            "subagents",
            "ask_user",
            "plan_mode_present",
            "read",
          ],
          toolProfileOptions: { jira: [], confluence: [], web_search: [] },
        }),
      } as never,
      subagentProfiles: { usable: async () => options.usable as never },
    });
    return await port.prepare({
      conversation: {
        id: "c",
        projectId: "p",
        parentConversationId: options.parent,
      } as Conversation,
      config: {
        mode: "coding",
        workingDirectory: home,
        systemPrompt: null,
        instructions: options.instructions ?? null,
      } as ConversationConfig,
      projectDir: home,
      coreTools,
    });
  } finally {
    await rm(home, { recursive: true });
  }
}

const names = (tools: ToolDefinition[]) => tools.map((entry) => entry.name);

void test("sub-agent conversations lose blocked tools", async () => {
  const { tools } = await prepare({
    parent: "lead",
    usable: [{ name: "explore", description: "Research" }],
  });
  assert.deepEqual(names(tools), ["read"]);
});

void test("leads get a profile enum and description from the usable profiles", async () => {
  const { tools } = await prepare({
    parent: null,
    usable: [
      { name: "explore", description: "Read-only research" },
      { name: "developer", description: "Edits code" },
    ],
  });
  assert.ok(names(tools).includes("subagent_status"));
  const parameters = tools.find((entry) => entry.name === "subagent_prompt")!
    .parameters as unknown as {
    properties: {
      assignments: {
        items: {
          properties: { profile: { enum: string[]; description: string } };
        };
      };
    };
  };
  const profile = parameters.properties.assignments.items.properties.profile;
  assert.deepEqual(profile.enum, ["explore", "developer"]);
  assert.match(
    profile.description,
    /explore — Read-only research\ndeveloper — Edits code/,
  );
  // The catalog definition itself is untouched.
  assert.equal(
    JSON.stringify(tool("subagent_prompt").parameters).includes("developer"),
    false,
  );
});

void test("sub-agent tools are dropped when no profile is usable", () => {
  assert.deepEqual(names(withSubagentProfiles(coreTools, [])), [
    "ask_user",
    "plan_mode_present",
  ]);
});

void test("instructions render between context files and skills", () => {
  const prompt = buildNerveSystemPrompt({
    cwd: "/w",
    contextFiles: [{ path: "AGENTS.md", content: "rules" }],
    instructions: "  Report briefly.  ",
    selectedTools: ["read"],
    skills: [{ name: "s", description: "d", filePath: "/s/SKILL.md" } as never],
  });
  const at = (text: string) => prompt.indexOf(text);
  assert.match(
    prompt,
    /<agent_instructions>\nReport briefly\.\n<\/agent_instructions>/,
  );
  assert.ok(at("project_instructions") < at("<agent_instructions>"));
  assert.ok(at("<agent_instructions>") < at("<available_skills>"));
  assert.doesNotMatch(
    buildNerveSystemPrompt({ cwd: "/w", instructions: null }),
    /agent_instructions/,
  );
});
