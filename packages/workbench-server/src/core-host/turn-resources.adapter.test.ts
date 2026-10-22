import { builtInAgentProfiles } from "../domains/agent-profiles/builtin-agent-profiles.js";
import type { AppliedAgentProfile } from "@nervekit/contracts/agent-profiles";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { ConversationConfig } from "@nervekit/contracts/core";
import { resolveAgentProfiles } from "@nervekit/contracts/agent-profiles";
import type { Skill } from "@nervekit/harness/resources";
import { builtinSkillFilePath, NerveSkillCatalog } from "@nervekit/skills";
import { AgentBrowserSkillCatalog } from "./agent-browser-skills.js";
import { listAvailableSkills } from "./resource-loader.js";
import {
  toolDefinitionByName,
  type ToolDefinition,
} from "@nervekit/tools/catalog";
import {
  createTurnResourcesPort,
  withAgentProfiles,
} from "./turn-resources.adapter.js";
import { buildNerveSystemPrompt } from "./nerve-system-prompt.js";

const tool = (name: string) => toolDefinitionByName(name) as ToolDefinition;
const coreTools = [
  "subagent_prompt",
  "subagent_status",
  "subagent_stop",
  "ask_user",
  "plan_present",
].map(tool);

async function prepare(options: {
  parent: string | null;
  usable: { name: string; description: string; permission?: string }[];
  toolDescription?: string;
  customPrompt?: string;
  nestedWorkingDirectory?: boolean;
  instructions?: string | null;
  appliedAgentProfile?: AppliedAgentProfile;
  hasExistingSubagents?: boolean;
  subagentsEnabled?: boolean;
  agentProfile?: ConversationConfig["agentProfile"];
  planToolSource?: "host" | "core";
}) {
  const home = await mkdtemp(join(tmpdir(), "nerve-turn-"));
  try {
    if (options.customPrompt) {
      await mkdir(join(home, ".nerve"));
      await writeFile(join(home, ".nerve", "SYSTEM.md"), options.customPrompt);
    }
    const workingDirectory = options.nestedWorkingDirectory
      ? join(home, "nested")
      : home;
    if (options.nestedWorkingDirectory) {
      await mkdir(workingDirectory);
      await writeFile(join(home, "AGENTS.md"), "Project root marker");
      await writeFile(
        join(workingDirectory, "AGENTS.md"),
        "Nested working marker",
      );
      await mkdir(join(home, ".nerve"), { recursive: true });
      await writeFile(
        join(home, ".nerve", "APPEND_SYSTEM.md"),
        "Project append marker",
      );
    }
    const port = createTurnResourcesPort({
      home,
      tools: () => [
        {
          ...tool("read"),
          ...(options.toolDescription
            ? { description: options.toolDescription }
            : {}),
        },
        ...(options.planToolSource === "host" ? [tool("plan_present")] : []),
      ],
      skillCatalogs: {
        nerve: { skills: [] },
        agentBrowser: { skills: [] },
      },
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
          availableTools: ["subagents", "ask_user", "plan_present", "read"],
          toolProfileOptions: { jira: [], confluence: [], web_search: [] },
        }),
      } as never,
      agentProfiles: {
        list: async () => [],
        preview: async () => {
          throw new Error("Not a draft");
        },
        usable: async (context) => {
          assert.notEqual(
            options.subagentsEnabled,
            false,
            "master switch bypasses profile/child checks",
          );
          assert.equal(context.projectId, "p");
          assert.equal(context.conversationId, "c");
          assert.equal(
            context.parentConfig?.agentProfile,
            options.agentProfile,
          );
          return options.usable.map((profile) => ({
            ...profile,
            permission: { set: profile.permission ?? "read_only" },
          })) as never;
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
        agentProfile: options.agentProfile,
        workingDirectory,
        systemPrompt: null,
        instructions: options.instructions ?? null,
      } as ConversationConfig,
      appliedAgentProfile: options.appliedAgentProfile,
      projectDir: home,
      coreTools:
        options.planToolSource === "host"
          ? coreTools.filter((entry) => entry.name !== "plan_present")
          : coreTools,
    });
  } finally {
    await rm(home, { recursive: true });
  }
}

const names = (tools: ToolDefinition[]) => tools.map((entry) => entry.name);

for (const planToolSource of ["host", "core"] as const) {
  void test(`${planToolSource} plan tool is controlled by capabilities, not profile name`, async () => {
    const { tools, systemPrompt } = await prepare({
      parent: null,
      usable: [],
      agentProfile: "coding",
      planToolSource,
    });
    assert.ok(names(tools).includes("plan_present"));
    assert.match(
      tools.find((t) => t.name === "plan_present")!.description,
      / Plan storage: \/.*\/data\/plans\.$/,
    );
    assert.doesNotMatch(systemPrompt, /<mode_controls>|<plan_mode/);
  });
}

void test("planning mode does not expose blocked tools to sub-agents", async () => {
  const { tools } = await prepare({
    parent: "lead",
    usable: [],
    agentProfile: "planning",
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

void test("leads get a profile enum and a prompt listing with permission display names", async () => {
  const { tools, systemPrompt } = await prepare({
    parent: null,
    usable: [
      { name: "explore", description: "Read-only research" },
      {
        name: "developer",
        description: "Edits code",
        permission: "autonomous",
      },
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
  assert.equal(profile.description, undefined);
  assert.match(
    systemPrompt,
    /<available_agent_profiles>\n- explore: Read-only research \(permission: Read only\)\n- developer: Edits code \(permission: Autonomous\)\n<\/available_agent_profiles>/,
  );
  // The catalog definition itself is untouched.
  assert.equal(
    JSON.stringify(tool("subagent_prompt").parameters).includes("developer"),
    false,
  );
});

void test("sub-agent tools are dropped when no profile is usable", () => {
  assert.deepEqual(names(withAgentProfiles(coreTools, [])), [
    "ask_user",
    "plan_present",
  ]);
});

void test("existing agents retain follow-up, status and stop tools without usable profiles", async () => {
  const { tools, systemPrompt } = await prepare({
    parent: null,
    usable: [],
    hasExistingSubagents: true,
  });
  assert.deepEqual(
    names(tools).filter((name) => name.startsWith("subagent_")),
    ["subagent_prompt", "subagent_status", "subagent_stop"],
  );
  assert.doesNotMatch(systemPrompt, /<available_agent_profiles>/);
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

void test("preparation reads initialized catalogs and current selections without changing prior prompts", async () => {
  const home = await mkdtemp(join(tmpdir(), "nerve-catalog-turn-"));
  const nerve = new NerveSkillCatalog();
  const browserSkill: Skill = {
    name: "core",
    description: "Browser automation",
    filePath: join(home, "core", "SKILL.md"),
    content: "Use the browser",
  };
  const agentBrowser = new AgentBrowserSkillCatalog({
    async run(args) {
      return args[1] === "--json"
        ? JSON.stringify({
            data: [{ name: "core", description: browserSkill.description }],
          })
        : `---\nname: core\ndescription: ${browserSkill.description}\n---\n${browserSkill.content}`;
    },
  });
  const enabled = { nerve: ["skill-creator"], agentBrowser: ["core"] };
  try {
    // Isolate catalog selection from skills installed in the developer's home.
    const disabledFileSkills = (
      await listAvailableSkills(home, { storageHome: home })
    ).skills.map(({ name }) => name);
    const port = createTurnResourcesPort({
      home,
      tools: () => [tool("read")],
      skillCatalogs: { nerve, agentBrowser },
      capabilities: {
        configuration: async () => ({
          effective: {
            disabledTools: [],
            toolProfiles: {},
            enabledNerveSkills: [...enabled.nerve],
            enabledAgentBrowserSkills: [...enabled.agentBrowser],
            disabledFileSkills,
          },
          availableTools: ["read"],
          toolProfileOptions: { jira: [], confluence: [], web_search: [] },
        }),
      } as never,
      agentProfiles: {
        list: async () => [],
        usable: async () => [],
        preview: async () => {
          throw new Error("No profile preview expected");
        },
      },
      hasExistingSubagents: () => false,
    });
    const input = {
      conversation: { id: "c", projectId: "p", parentConversationId: null },
      config: {
        agentProfile: "coding",
        workingDirectory: home,
        systemPrompt: null,
        instructions: null,
      } as ConversationConfig,
      projectDir: home,
    };
    // Consumers exist before initialization, but execution starts after readiness.
    assert.equal(nerve.skills.length, 0);
    assert.equal(agentBrowser.skills.length, 0);
    await nerve.initialize();
    await agentBrowser.initialize();
    const initialized = await port.prepare(input);
    assert.match(initialized.systemPrompt, /<name>skill-creator<\/name>/);
    assert.match(initialized.systemPrompt, /<name>core<\/name>/);
    assert.doesNotMatch(initialized.systemPrompt, /<name>team-lead<\/name>/);

    enabled.nerve = ["team-lead"];
    enabled.agentBrowser = [];
    const changed = await port.prepare(input);
    assert.match(changed.systemPrompt, /<name>team-lead<\/name>/);
    assert.doesNotMatch(
      changed.systemPrompt,
      /<name>(skill-creator|core)<\/name>/,
    );
    assert.match(initialized.systemPrompt, /<name>skill-creator<\/name>/);

    enabled.nerve = [];
    assert.doesNotMatch(
      (await port.prepare(input)).systemPrompt,
      /<available_skills>/,
    );
  } finally {
    await agentBrowser.shutdown();
    await rm(home, { recursive: true, force: true });
  }
});

void test("instructions render before context files and skills", () => {
  const prompt = buildNerveSystemPrompt({
    cwd: "/w",
    contextFiles: [{ path: "AGENTS.md", content: "rules" }],
    instructions: "  Report briefly.  ",
    selectedTools: ["read"],
    skills: [{ name: "s", description: "d", filePath: "/s/SKILL.md" } as never],
  });
  const at = (text: string) => prompt.indexOf(text);
  assert.match(prompt, /<instructions>\nReport briefly\.\n<\/instructions>/);
  assert.ok(at("<instructions>") < at("project_instructions"));
  assert.ok(at("<instructions>") < at("<available_skills>"));
  assert.doesNotMatch(
    buildNerveSystemPrompt({ cwd: "/w", instructions: null }),
    /instructions/,
  );
});

void test("turn preparation resolves instruction and tool description skill placeholders", async () => {
  const { tools, systemPrompt } = await prepare({
    parent: null,
    usable: [],
    instructions: "Read {{skill:team-lead}} and {{skill:unknown}}.",
    toolDescription: "Guide: {{skill:team-lead}}; again {{skill:team-lead}}.",
  });
  const path = builtinSkillFilePath("team-lead");
  assert.ok(path);
  assert.ok(systemPrompt.includes(`Read ${path} and {{skill:unknown}}.`));
  assert.equal(
    tools.find((entry) => entry.name === "read")?.description,
    `Guide: ${path}; again ${path}.`,
  );
});

void test("project SYSTEM.md is ignored without dropping conversation instructions or profile listings", async () => {
  const { systemPrompt } = await prepare({
    parent: null,
    usable: [{ name: "explore", description: "Research" }],
    customPrompt: "Custom system intro",
    instructions: "Keep these instructions",
  });
  assert.match(systemPrompt, /You are Nerve's coding agent/);
  assert.match(systemPrompt, /<guidelines>/);
  assert.doesNotMatch(systemPrompt, /Custom system intro/);
  assert.match(systemPrompt, /<instructions>\nKeep these instructions/);
  assert.match(systemPrompt, /<available_agent_profiles>/);
  assert.match(systemPrompt, /<environment>/);
});

void test("active lead instructions resolve skill placeholders alongside conversation instructions", async () => {
  const profile = resolveAgentProfiles({
    builtins: builtInAgentProfiles,
    layers: [],
    scope: "user",
  }).profiles.find((p) => p.name === "coding")!.effective!;
  profile.instructions = "Profile: read {{skill:team-lead}}.";
  const { systemPrompt } = await prepare({
    parent: null,
    usable: [],
    agentProfile: "coding",
    appliedAgentProfile: {
      schemaVersion: 1,
      name: profile.name,
      instructions: profile.instructions,
      locked: {},
    },
    instructions: "Conversation-specific rules.",
  });
  assert.match(systemPrompt, /<instructions>\nProfile: read/);
  assert.ok(systemPrompt.includes(builtinSkillFilePath("team-lead")!));
  assert.ok(
    systemPrompt.indexOf("Profile: read") <
      systemPrompt.indexOf("Conversation-specific rules."),
  );
  assert.doesNotMatch(systemPrompt, /\{\{skill:/);
  profile.instructions = "Edited profile rules.";
  assert.match(
    (
      await prepare({
        parent: null,
        usable: [],
        agentProfile: "coding",
        appliedAgentProfile: {
          schemaVersion: 1,
          name: profile.name,
          instructions: profile.instructions,
          locked: {},
        },
      })
    ).systemPrompt,
    /Edited profile rules/,
  );
});

void test("turn preparation uses the conversation working directory within the project prompt boundary", async () => {
  const { systemPrompt } = await prepare({
    parent: null,
    usable: [],
    nestedWorkingDirectory: true,
  });
  assert.match(systemPrompt, /Project root marker/);
  assert.match(systemPrompt, /Nested working marker/);
  assert.match(systemPrompt, /Project append marker/);
  assert.ok(
    systemPrompt.indexOf("Project root marker") <
      systemPrompt.indexOf("Nested working marker"),
  );
});
