import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  allToolDefinitions,
  coreToolDefinitionByName,
  coreToolDefinitions,
  coreToolDescriptors,
  MODEL_TOOL_RESULT_MAX_BYTES,
} from "@nervekit/host-runtime/tools";
import type { AgentRecord } from "@nervekit/contracts";
import { coreToolNameSchema } from "@nervekit/contracts";
import {
  exploreRunPlanArg,
  exploreSystemPrompt,
} from "../src/domains/agents/run/subagent-runner.js";
import {
  activeToolNamesForAgent,
  activeToolNamesForExploreAgent,
  contentBlocksFromResult,
} from "../src/domains/tools/agent-tool-adapter.js";

describe("agent tool definitions", () => {
  it("matches shared core tool names and derives descriptors from definitions", () => {
    const schemaNames = new Set(coreToolNameSchema.options);
    const definitionNames = new Set(
      coreToolDefinitions.map((tool) => tool.name),
    );
    const descriptorNames = new Set(
      coreToolDescriptors.map((tool) => tool.name),
    );

    assert.deepEqual(definitionNames, schemaNames);
    assert.deepEqual(descriptorNames, schemaNames);
    assert.deepEqual(
      [...definitionNames],
      [
        "read",
        "bash",
        "python",
        "edit",
        "write",
        "grep",
        "find",
        "ls",
        "ask_user",
        "todos_set",
        "todos_get",
        "web_search",
        "web_fetch",
        "jira_search_users",
        "jira_search_issues",
        "jira_get_issue",
        "jira_get_project",
        "jira_create_issue",
        "jira_update_issue",
        "jira_add_comment",
        "jira_transition_issue",
        "confluence_search_spaces",
        "confluence_search_pages",
        "confluence_get_page",
        "confluence_download_pages",
        "confluence_create_page",
        "confluence_update_page",
        "confluence_publish_pages",
        "confluence_upload_attachment",
      ],
    );

    for (const definition of coreToolDefinitions) {
      assert.equal(typeof definition.description, "string");
      assert.ok(definition.description.length > 0);
      assert.ok(definition.parameters);
      assert.equal(
        coreToolDescriptors.find((tool) => tool.name === definition.name)
          ?.description,
        definition.description,
      );
    }
  });

  it("filters user-disabled configurable tools", () => {
    assert.ok(
      !activeToolNamesForAgent(agent("autonomous"), {
        disabledToolNames: ["web_search", "web_fetch"],
      }).includes("web_search"),
    );
    assert.ok(
      !activeToolNamesForAgent(agent("autonomous"), {
        disabledToolNames: ["web_search", "web_fetch"],
      }).includes("web_fetch"),
    );
    assert.ok(
      activeToolNamesForAgent(agent("autonomous"), {
        disabledToolNames: ["web_search", "web_fetch"],
      }).includes("bash"),
    );
    assert.deepEqual(
      activeToolNamesForAgent(agent("autonomous"), {
        pythonAvailable: true,
        disabledToolNames: ["python"],
      }).slice(0, 2),
      ["read", "bash"],
    );
    assert.ok(
      !activeToolNamesForAgent(agent("autonomous"), {
        pythonAvailable: true,
        disabledToolNames: ["python"],
      }).includes("python"),
    );
  });

  it("uses expected default active tools", () => {
    const codingTools = [
      "read",
      "bash",
      "edit",
      "write",
      "grep",
      "find",
      "ls",
      "ask_user",
      "todos_set",
      "todos_get",
      "web_search",
      "web_fetch",
      "task_start",
      "task_status",
      "task_logs",
      "task_cancel",
      "task_restart",
      "explore",
      "plan_mode_enter",
    ];
    const planningTools = [
      "read",
      "bash",
      "edit",
      "write",
      "grep",
      "find",
      "ls",
      "ask_user",
      "todos_set",
      "todos_get",
      "web_search",
      "web_fetch",
      "task_status",
      "task_logs",
      "explore",
      "plan_mode_enter",
      "plan_mode_present",
      "plan_mode_force_exit",
    ];
    assert.deepEqual(activeToolNamesForAgent(agent("autonomous")), codingTools);
    assert.deepEqual(activeToolNamesForAgent(agent("supervised")), codingTools);
    assert.deepEqual(
      activeToolNamesForAgent(agent("autonomous"), { pythonAvailable: true }),
      ["read", "bash", "python", ...codingTools.slice(2)],
    );
    assert.deepEqual(
      activeToolNamesForAgent({ ...agent("autonomous"), mode: "planning" }),
      planningTools,
    );
    assert.deepEqual(
      activeToolNamesForAgent(
        { ...agent("autonomous"), mode: "planning" },
        { pythonAvailable: true },
      ),
      ["read", "bash", "python", ...planningTools.slice(2)],
    );
    assert.deepEqual(activeToolNamesForAgent(agent("read_only")), [
      "read",
      "grep",
      "find",
      "ls",
      "ask_user",
      "todos_set",
      "todos_get",
      "task_status",
      "task_logs",
      "plan_mode_enter",
    ]);
    assert.deepEqual(
      activeToolNamesForAgent({ ...agent("read_only"), mode: "planning" }),
      [
        "read",
        "grep",
        "find",
        "ls",
        "ask_user",
        "todos_set",
        "todos_get",
        "task_status",
        "task_logs",
        "plan_mode_enter",
        "plan_mode_present",
        "plan_mode_force_exit",
      ],
    );
  });

  it("gates Jira and Confluence active tools behind module settings", () => {
    const defaultCoding = activeToolNamesForAgent(agent("autonomous"));
    assert.equal(
      defaultCoding.some((name) => name.startsWith("jira_")),
      false,
    );
    assert.equal(
      defaultCoding.some((name) => name.startsWith("confluence_")),
      false,
    );

    assert.deepEqual(
      activeToolNamesForAgent(agent("autonomous"), {
        jiraEnabled: true,
      }).filter((name) => name.startsWith("jira_")),
      [
        "jira_search_users",
        "jira_search_issues",
        "jira_get_issue",
        "jira_get_project",
        "jira_create_issue",
        "jira_update_issue",
        "jira_add_comment",
        "jira_transition_issue",
      ],
    );
    assert.deepEqual(
      activeToolNamesForAgent(agent("autonomous"), {
        confluenceEnabled: true,
      }).filter((name) => name.startsWith("confluence_")),
      [
        "confluence_search_spaces",
        "confluence_search_pages",
        "confluence_get_page",
        "confluence_download_pages",
        "confluence_create_page",
        "confluence_update_page",
        "confluence_publish_pages",
        "confluence_upload_attachment",
      ],
    );
    assert.deepEqual(
      activeToolNamesForAgent(
        { ...agent("autonomous"), mode: "planning" },
        { jiraEnabled: true },
      ).filter((name) => name.startsWith("jira_")),
      [
        "jira_search_users",
        "jira_search_issues",
        "jira_get_issue",
        "jira_get_project",
      ],
    );
    assert.deepEqual(
      activeToolNamesForAgent(
        { ...agent("autonomous"), mode: "planning" },
        { confluenceEnabled: true },
      ).filter((name) => name.startsWith("confluence_")),
      [
        "confluence_search_spaces",
        "confluence_search_pages",
        "confluence_get_page",
        "confluence_download_pages",
      ],
    );
    assert.equal(
      activeToolNamesForAgent(agent("read_only"), { jiraEnabled: true }).some(
        (name) => name.startsWith("jira_"),
      ),
      false,
    );
    assert.equal(
      activeToolNamesForAgent(agent("read_only"), {
        confluenceEnabled: true,
      }).some((name) => name.startsWith("confluence_")),
      false,
    );
  });

  it("exposes orchestration tools to the harness definition set", () => {
    assert.deepEqual(
      allToolDefinitions
        .map((tool) => tool.name)
        .filter(
          (name) =>
            name.startsWith("task_") ||
            name === "explore" ||
            name.startsWith("plan_"),
        ),
      [
        "task_start",
        "task_status",
        "task_logs",
        "task_cancel",
        "task_restart",
        "explore",
        "plan_mode_enter",
        "plan_mode_present",
        "plan_mode_force_exit",
      ],
    );
  });

  it("documents awaited bash use and detached task_start use", () => {
    const bash = allToolDefinitions.find((tool) => tool.name === "bash");
    const taskStart = allToolDefinitions.find(
      (tool) => tool.name === "task_start",
    );

    assert.ok(bash);
    assert.ok(taskStart);
    assert.equal(bash.promptSnippet, "Run awaited shell commands");
    assert.ok(
      bash.promptGuidelines?.some((line) =>
        line.includes("Prefer read/grep/find/ls over shell"),
      ),
    );
    assert.ok(
      bash.promptGuidelines?.some((line) =>
        line.includes("Use bash for finite checks"),
      ),
    );
    assert.doesNotMatch(bash.promptSnippet ?? "", /ls, grep, find/);
    assert.match(taskStart.description, /supervised background process/);
    assert.ok(
      taskStart.promptGuidelines?.some((line) =>
        line.includes("long-lived processes"),
      ),
    );
    assert.equal(
      taskStart.promptGuidelines?.some((line) =>
        line.includes("tests, builds"),
      ),
      false,
    );
  });

  it("defines explore as a parallel read-only delegation tool with required context", () => {
    const explore = allToolDefinitions.find((tool) => tool.name === "explore");
    assert.ok(explore);
    assert.equal(explore.executionMode, "parallel");
    assert.ok(explore.description.includes("context"));
    assert.ok(explore.description.includes("split_rationale"));
    assert.ok(
      explore.promptGuidelines?.some((line) => line.includes("quick lookup")),
    );
  });

  it("bounds model-facing text content blocks with one aggregate budget", () => {
    const blocks = contentBlocksFromResult({
      contentBlocks: [
        { type: "text", text: "x".repeat(15_000) },
        { type: "text", text: "y".repeat(15_000) },
      ],
      details: {
        outputLimits: { continuation: { nextOffset: 1000 } },
      },
    });
    const text = (blocks ?? [])
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("\n");

    assert.ok(Buffer.byteLength(text, "utf8") <= MODEL_TOOL_RESULT_MAX_BYTES);
    assert.equal(text.match(/tool result truncated/g)?.length, 1);
    assert.match(text, /Continue with offset 1000/);
  });

  it("uses a restricted tool allowlist for explore child agents", () => {
    assert.deepEqual(activeToolNamesForExploreAgent(), [
      "read",
      "grep",
      "find",
      "ls",
      "task_status",
      "task_logs",
    ]);
  });

  it("normalizes single explore run plans", () => {
    assert.deepEqual(
      exploreRunPlanArg({
        task: "Map how OAuth credentials are stored and retrieved.",
        context:
          "I checked auth routes and storage initialization. Need the detailed credential repository flow and encryption boundary.",
        label: "auth storage",
      }),
      {
        mode: "single",
        context:
          "I checked auth routes and storage initialization. Need the detailed credential repository flow and encryption boundary.",
        tasks: [
          {
            task: "Map how OAuth credentials are stored and retrieved.",
            label: "auth storage",
          },
        ],
      },
    );
  });

  it("normalizes parallel explore run plans", () => {
    const plan = exploreRunPlanArg({
      context:
        "I checked agent-runner and subagent-runner at a high level. Need independent mapping of abort and child lifecycle details.",
      split_rationale:
        "The abort route and child lifecycle are independent areas, and two agents are sufficient for this investigation.",
      tasks: [
        {
          task: "Map parent abort routing and WorkbenchAgentMechanics abort behavior.",
          label: "parent abort",
        },
        {
          task: "Map explore child creation, run registration, and cleanup.",
          label: "child lifecycle",
        },
      ],
    });
    assert.equal(plan.mode, "parallel");
    assert.equal(plan.tasks.length, 2);
    assert.equal(plan.splitRationale?.includes("independent"), true);
  });

  it("rejects invalid explore run plans with helpful errors", () => {
    const context =
      "I checked likely files with grep/read and need focused follow-up mapping.";
    const split_rationale =
      "The two investigations are independent enough to split, and two agents match the two ownership areas.";
    assert.throws(() => exploreRunPlanArg({}), /exactly one/);
    assert.throws(
      () =>
        exploreRunPlanArg({
          task: "Map authentication flow details.",
          tasks: [{ task: "Map tool execution flow details." }],
          context,
        }),
      /exactly one/,
    );
    assert.throws(
      () => exploreRunPlanArg({ task: "Map authentication flow details." }),
      /context/,
    );
    assert.throws(
      () =>
        exploreRunPlanArg({
          task: "Map authentication flow details.",
          context: "too short",
        }),
      /context/,
    );
    assert.throws(
      () => exploreRunPlanArg({ task: "Map auth", context }),
      /too vague/,
    );
    assert.throws(
      () =>
        exploreRunPlanArg({
          tasks: [{ task: "Map authentication flow details." }],
          context,
          split_rationale,
        }),
      /at least 2/,
    );
    assert.throws(
      () =>
        exploreRunPlanArg({
          tasks: Array.from({ length: 6 }, (_, index) => ({
            task: `Map subsystem ${index} integration details thoroughly.`,
          })),
          context,
          split_rationale,
        }),
      /at most 5/,
    );
    assert.throws(
      () =>
        exploreRunPlanArg({
          tasks: [
            {
              task: "Map parent abort routing and WorkbenchAgentMechanics behavior.",
            },
            { task: "Map child lifecycle cleanup and run registration." },
          ],
          context,
        }),
      /split_rationale/,
    );
    assert.throws(
      () =>
        exploreRunPlanArg({
          tasks: [
            {
              task: "Map parent abort routing and WorkbenchAgentMechanics behavior.",
            },
            { task: "Map child lifecycle cleanup and run registration." },
          ],
          context,
          split_rationale: "too short",
        }),
      /split_rationale/,
    );
    assert.throws(
      () =>
        exploreRunPlanArg({
          tasks: [
            {
              task: "Map parent abort routing and WorkbenchAgentMechanics behavior.",
            },
            {
              task: "map   parent abort routing and workbenchagentmechanics behavior.",
            },
          ],
          context,
          split_rationale,
        }),
      /distinct/,
    );
  });

  it("documents explore child-agent prompt constraints", () => {
    const prompt = exploreSystemPrompt();
    assert.ok(prompt.includes("Start with grep/find/ls"));
    assert.ok(prompt.includes("Do not ask the user questions"));
    assert.match(prompt, /^# Findings$/m);
    assert.match(prompt, /^## Summary\n- One to five/m);
    assert.doesNotMatch(prompt, /^ +# Findings$/m);
  });

  it("defines ask_user as a sequential free-text interaction tool", () => {
    const askUser = coreToolDefinitionByName("ask_user");
    assert.equal(askUser.label, "Ask User");
    assert.equal(askUser.executionMode, "sequential");
    assert.ok(askUser.description.includes("free-text"));
    assert.ok(askUser.parameters);
  });

  it("normalizes edit convenience arguments", () => {
    const edit = coreToolDefinitionByName("edit");
    const preparedEdit = edit.prepareArguments?.({
      path: "src/file.ts",
      replacements: JSON.stringify([{ oldText: "old", newText: "new" }]),
    }) as {
      path: string;
      replacements: Array<{ oldText: string; newText: string }>;
    };
    assert.deepEqual(preparedEdit, {
      path: "src/file.ts",
      replacements: [{ oldText: "old", newText: "new" }],
    });
  });
});

function agent(permissionLevel: AgentRecord["permissionLevel"]): AgentRecord {
  return {
    id: "agent_01HN0000000000000000000000",
    conversationId: "conv_01HN0000000000000000000000",
    projectId: "proj_01HN0000000000000000000000",
    projectDir: "/tmp/project",
    workerId: "worker_01HN0000000000000000000000",
    rootAgentId: "agent_01HN0000000000000000000000",
    mode: "coding",
    permissionLevel,
    workspaceScope: { roots: ["/tmp/project"] },
    budget: { depth: 0, maxDepth: 3, maxRuns: 8, usedRuns: 0 },
    status: "idle",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}
