import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import type { AgentRecord } from "@nerve/shared";
import { coreToolNameSchema, defaultSettings } from "@nerve/shared";
import {
  allToolDefinitions,
  coreToolDefinitionByName,
  coreToolDefinitions,
  coreToolDescriptors,
} from "@nerve/tools";
import {
  exploreRunPlanArg,
  exploreSystemPrompt,
} from "../src/domains/agents/run/subagent-runner.js";
import {
  activeToolNamesForAgent,
  activeToolNamesForExploreAgent,
  contentBlocksFromResult,
} from "../src/domains/tools/agent-tool-adapter.js";
import { ToolService } from "../src/domains/tools/tool-service.js";
import { storagePaths } from "../src/infrastructure/storage/index.js";

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
        "smart_edit",
        "write",
        "grep",
        "find",
        "ls",
        "ask_user",
        "todos_set",
        "todos_get",
        "web_search",
        "web_fetch",
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

  it("uses expected default active tools", () => {
    const codingTools = [
      "read",
      "bash",
      "edit",
      "smart_edit",
      "write",
      "grep",
      "find",
      "ls",
      "task_start",
      "task_status",
      "task_logs",
      "task_cancel",
      "task_restart",
      "task_list",
      "explore",
      "ask_user",
      "todos_set",
      "todos_get",
      "web_search",
      "web_fetch",
      "plan_mode_enter",
    ];
    const planningTools = [
      "read",
      "bash",
      "edit",
      "smart_edit",
      "write",
      "grep",
      "find",
      "ls",
      "task_status",
      "task_logs",
      "task_list",
      "explore",
      "ask_user",
      "todos_set",
      "todos_get",
      "web_search",
      "web_fetch",
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
      "task_status",
      "task_logs",
      "task_list",
      "ask_user",
      "todos_set",
      "todos_get",
      "plan_mode_enter",
    ]);
    assert.deepEqual(
      activeToolNamesForAgent({ ...agent("read_only"), mode: "planning" }),
      [
        "read",
        "grep",
        "find",
        "ls",
        "task_status",
        "task_logs",
        "task_list",
        "ask_user",
        "todos_set",
        "todos_get",
        "plan_mode_enter",
        "plan_mode_present",
        "plan_mode_force_exit",
      ],
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
        "task_list",
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
        line.includes("Use dedicated file tools when available"),
      ),
    );
    assert.ok(
      bash.promptGuidelines?.some((line) =>
        line.includes("Use bash for finite shell work whose result matters"),
      ),
    );
    assert.doesNotMatch(bash.promptSnippet ?? "", /ls, grep, find/);
    assert.match(taskStart.description, /supervised detached background tasks/);
    assert.ok(
      taskStart.promptGuidelines?.some((line) =>
        line.includes("Do not use task_start for finite tests/checks/builds"),
      ),
    );
    assert.equal(
      taskStart.promptGuidelines?.some((line) =>
        line.includes("Use task_start for tests, builds"),
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
      explore.promptGuidelines?.some((line) =>
        line.includes("quick grep/find/read"),
      ),
    );
  });

  it("bounds model-facing text content blocks generically", () => {
    const blocks = contentBlocksFromResult({
      contentBlocks: [{ type: "text", text: "x".repeat(30_000) }],
    });

    assert.equal(blocks?.[0]?.type, "text");
    assert.ok(((blocks?.[0] as { text?: string })?.text ?? "").length < 26_000);
    assert.match((blocks?.[0] as { text?: string })?.text ?? "", /truncated/);
  });

  it("uses a restricted tool allowlist for explore child agents", () => {
    assert.deepEqual(activeToolNamesForExploreAgent(), [
      "read",
      "grep",
      "find",
      "ls",
      "task_status",
      "task_logs",
      "task_list",
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
          task: "Map parent abort routing and AgentRunner abort behavior.",
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
            { task: "Map parent abort routing and AgentRunner behavior." },
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
            { task: "Map parent abort routing and AgentRunner behavior." },
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
            { task: "Map parent abort routing and AgentRunner behavior." },
            { task: "map   parent abort routing and agEntrunner behavior." },
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
  });

  it("defines ask_user as a sequential free-text interaction tool", () => {
    const askUser = coreToolDefinitionByName("ask_user");
    assert.equal(askUser.label, "Ask User");
    assert.equal(askUser.executionMode, "sequential");
    assert.ok(askUser.description.includes("free-text"));
    assert.ok(askUser.parameters);
  });

  it("normalizes legacy single-edit arguments to the multi-edit schema", () => {
    const edit = coreToolDefinitionByName("edit");
    const prepared = edit.prepareArguments?.({
      path: "src/file.ts",
      oldText: "old",
      newText: "new",
    }) as { path: string; edits: Array<{ oldText: string; newText: string }> };

    assert.deepEqual(prepared, {
      path: "src/file.ts",
      edits: [{ oldText: "old", newText: "new" }],
    });
  });

  it("records pre-execution provider tool-call errors as terminal tool records", async () => {
    const home = await mkdtemp(join(tmpdir(), "nerve-tool-error-"));
    const events: Array<{ type: string; data: unknown }> = [];
    const testAgent = agent("autonomous");
    const service = new ToolService(
      {
        paths: storagePaths(home),
        settings: defaultSettings,
        localToken: "test",
      },
      {
        publish: async (type: string, data: unknown) =>
          events.push({ type, data }),
      } as never,
      { upsertToolCall: () => undefined } as never,
      {} as never,
      {
        runtimeForProject: async () => undefined,
        isAvailableForProject: async () => false,
        statusSnapshot: () => ({
          available: false,
          source: "unavailable",
          error: "not used",
        }),
        refresh: async () => ({
          available: false,
          source: "unavailable",
          error: "not used",
        }),
      } as never,
      async () => {
        throw new Error("not used");
      },
      () => testAgent,
      async () => {
        throw new Error("not used");
      },
      async () => undefined,
      {} as never,
      async () => testAgent,
      {} as never,
    );

    const toolCall = await service.recordProviderToolCallError(
      testAgent,
      "edit",
      {
        path: "src/file.ts",
        edits: [{ oldText: "a", newText: "b", note: "bad" }],
      },
      "Validation failed for tool edit.",
      {
        providerToolCallId: "provider_call_1",
        sourceToolCallId: "provider_call_1",
        runId: "run_01H00000000000000000000000",
      },
    );

    assert.equal(toolCall.status, "error");
    assert.equal(toolCall.sourceToolCallId, "provider_call_1");
    assert.equal(toolCall.providerToolCallId, "provider_call_1");
    assert.equal(toolCall.error, "Validation failed for tool edit.");
    assert.deepEqual(toolCall.args, {
      path: "src/file.ts",
      edits: [{ oldText: "a", newText: "b", note: "bad" }],
    });
    assert.equal(
      service.findToolCallByProviderToolCallId("provider_call_1")?.id,
      toolCall.id,
    );
    assert.ok(
      events.some((event) => event.type === "conversation.tool_call.updated"),
    );

    const rawLog = await readFile(
      join(home, "logs", "tool-calls.jsonl"),
      "utf8",
    );
    assert.match(rawLog, /Validation failed for tool edit/);
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
