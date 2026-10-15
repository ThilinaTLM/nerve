import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { ConversationConfig } from "@nervekit/contracts/core";
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
  hasExistingSubagents?: boolean;
  subagentsEnabled?: boolean;
  mode?: ConversationConfig["mode"];
  planToolSource?: "host" | "core";
}) {
  const home = await mkdtemp(join(tmpdir(), "nerve-turn-"));
  try {
    const port = createTurnResourcesPort({
      home,
      tools: () => [
        tool("read"),
        ...(options.planToolSource === "host"
          ? [tool("plan_mode_present")]
          : []),
      ],
      skills: [],
      agentBrowserSkills: [],
      hasExistingSubagents: (id) => {
        assert.equal(id, "c");
        assert.notEqual(
          options.subagentsEnabled,
          false,
          "master switch bypasses profile/child checks",
        );
        return options.hasExistingSubagents ?? false;
      },
      capabilities: {
        configuration: async () => ({
          effective: {
            disabledTools:
              options.subagentsEnabled === false ? ["subagents"] : [],
            toolProfiles: {},
          },
          availableTools: [
            "subagents",
            "ask_user",
            "plan_mode_present",
            "read",
          ],
          toolProfileOptions: { jira: [], confluence: [], web_search: [] },
        }),
      } as never,
      subagentProfiles: {
        preview: async () => {
          throw new Error("Not a draft");
        },
        usable: async (context) => {
          assert.notEqual(
            options.subagentsEnabled,
            false,
            "master switch bypasses profile/child checks",
          );
          assert.deepEqual(context, { projectId: "p", conversationId: "c" });
          return options.usable as never;
        },
      },
    });
    return await port.prepare({
      conversation: {
        id: "c",
        projectId: "p",
        parentConversationId: options.parent,
      },
      config: {
        mode: options.mode,
        workingDirectory: home,
        systemPrompt: null,
        instructions: options.instructions ?? null,
      } as ConversationConfig,
      projectDir: home,
      coreTools:
        options.planToolSource === "host"
          ? coreTools.filter((entry) => entry.name !== "plan_mode_present")
          : coreTools,
    });
  } finally {
    await rm(home, { recursive: true });
  }
}

const names = (tools: ToolDefinition[]) => tools.map((entry) => entry.name);

for (const planToolSource of ["host", "core"] as const) {
  for (const mode of [undefined, "coding", "planning"] as const) {
    void test(`${planToolSource} plan tool is gated in ${mode ?? "default"} mode`, async () => {
      const { tools, systemPrompt } = await prepare({
        parent: null,
        usable: [],
        mode,
        planToolSource,
      });
      assert.equal(
        names(tools).includes("plan_mode_present"),
        mode === "planning",
      );
      assert.ok(names(tools).includes("read"));
      assert.ok(names(tools).includes("ask_user"));
      if (mode !== "planning")
        assert.doesNotMatch(
          systemPrompt,
          /plan_mode_present|<mode_controls>|<plan_mode/,
        );
    });
  }
}

void test("planning mode does not expose blocked tools to sub-agents", async () => {
  const { tools } = await prepare({
    parent: "lead",
    usable: [],
    mode: "planning",
  });
  assert.deepEqual(names(tools), ["read"]);
});

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

void test("existing agents retain follow-up, status and stop tools without usable profiles", async () => {
  const { tools } = await prepare({
    parent: null,
    usable: [],
    hasExistingSubagents: true,
  });
  assert.deepEqual(
    names(tools).filter((name) => name.startsWith("subagent_")),
    ["subagent_prompt", "subagent_status", "subagent_stop"],
  );
  const prompt = tools.find((entry) => entry.name === "subagent_prompt");
  assert.ok(prompt);
  const parameters = prompt.parameters as unknown as {
    properties: {
      assignments: {
        items: { properties: Record<string, unknown>; required: string[] };
      };
    };
  };
  const assignments = parameters.properties.assignments.items;
  assert.equal(Object.hasOwn(assignments.properties, "profile"), false);
  assert.deepEqual(assignments.required, ["name", "prompt"]);
  assert.doesNotMatch(JSON.stringify(parameters), /"enum":\[\]/);
  assert.match(prompt.description, /follow-up work for existing sub-agents/);
  assert.match(prompt.description, /new sub-agents cannot be created/);
  assert.ok(
    Object.hasOwn(
      (tool("subagent_prompt").parameters as unknown as typeof parameters)
        .properties.assignments.items.properties,
      "profile",
    ),
    "catalog schema remains untouched",
  );
});

void test("no profiles and no existing agents remove all sub-agent tools", async () => {
  const { tools } = await prepare({
    parent: null,
    usable: [],
    hasExistingSubagents: false,
  });
  assert.equal(
    names(tools).some((name) => name.startsWith("subagent_")),
    false,
  );
});

void test("the master capability removes sub-agent tools even with existing children", async () => {
  const { tools } = await prepare({
    parent: null,
    usable: [],
    hasExistingSubagents: true,
    subagentsEnabled: false,
  });
  assert.equal(
    names(tools).some((name) => name.startsWith("subagent_")),
    false,
  );
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
