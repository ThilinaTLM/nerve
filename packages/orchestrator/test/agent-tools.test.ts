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
import { exploreTasksArg } from "../src/domains/agents/run/subagent-runner.js";
import { activeToolNamesForAgent } from "../src/domains/tools/agent-tool-adapter.js";
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
      "write",
      "grep",
      "find",
      "ls",
      "process_start",
      "process_stop",
      "process_restart",
      "process_list",
      "process_logs",
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
      "write",
      "grep",
      "find",
      "ls",
      "process_list",
      "process_logs",
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
      activeToolNamesForAgent({ ...agent("autonomous"), mode: "planning" }),
      planningTools,
    );
    assert.deepEqual(activeToolNamesForAgent(agent("read_only")), [
      "read",
      "grep",
      "find",
      "ls",
      "process_list",
      "process_logs",
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
        "process_list",
        "process_logs",
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
            name.startsWith("process_") ||
            name === "explore" ||
            name.startsWith("plan_"),
        ),
      [
        "process_start",
        "process_stop",
        "process_restart",
        "process_list",
        "process_logs",
        "explore",
        "plan_mode_enter",
        "plan_mode_present",
        "plan_mode_force_exit",
      ],
    );
  });

  it("normalizes explore task arguments", () => {
    assert.deepEqual(exploreTasksArg({ task: "Map auth", label: "auth" }), [
      { task: "Map auth", label: "auth", context: undefined },
    ]);
    assert.deepEqual(
      exploreTasksArg({
        tasks: [
          { task: "Map auth" },
          { task: "Map tools", context: "Focus on dispatch" },
        ],
      }),
      [
        { task: "Map auth", label: undefined, context: undefined },
        { task: "Map tools", label: undefined, context: "Focus on dispatch" },
      ],
    );
    assert.throws(() => exploreTasksArg({}), /exactly one/);
    assert.throws(
      () =>
        exploreTasksArg({ task: "Map auth", tasks: [{ task: "Map tools" }] }),
      /exactly one/,
    );
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
