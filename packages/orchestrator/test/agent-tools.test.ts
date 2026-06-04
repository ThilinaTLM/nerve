import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AgentRecord } from "@nerve/shared";
import { coreToolNameSchema } from "@nerve/shared";
import {
  allToolDefinitions,
  coreToolDefinitionByName,
  coreToolDefinitions,
  coreToolDescriptors,
} from "@nerve/tools";
import { activeToolNamesForAgent } from "../src/agent-tool-adapter.js";

describe("agent tool definitions", () => {
  it("matches Pi core built-in tool names and derives descriptors from definitions", () => {
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
      ["read", "bash", "edit", "write", "grep", "find", "ls", "ask_user"],
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

  it("uses Pi-compatible default active tools", () => {
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
      "subagent_run",
      "ask_user",
      "plan_mode_enter",
      "plan_mode_status",
    ];
    const planningTools = [
      "read",
      "bash",
      "grep",
      "find",
      "ls",
      "process_list",
      "process_logs",
      "subagent_run",
      "ask_user",
      "plan_mode_enter",
      "plan_write",
      "plan_mode_present",
      "plan_mode_force_exit",
      "plan_mode_status",
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
      "plan_mode_enter",
      "plan_mode_present",
      "plan_mode_force_exit",
      "plan_mode_status",
    ]);
  });

  it("exposes orchestration tools to the harness definition set", () => {
    assert.deepEqual(
      allToolDefinitions
        .map((tool) => tool.name)
        .filter(
          (name) =>
            name.startsWith("process_") ||
            name === "subagent_run" ||
            name.startsWith("plan_"),
        ),
      [
        "process_start",
        "process_stop",
        "process_restart",
        "process_list",
        "process_logs",
        "subagent_run",
        "plan_mode_enter",
        "plan_write",
        "plan_mode_present",
        "plan_mode_force_exit",
        "plan_mode_status",
      ],
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
});

function agent(permissionLevel: AgentRecord["permissionLevel"]): AgentRecord {
  return {
    id: "agent_01HN0000000000000000000000",
    sessionId: "ses_01HN0000000000000000000000",
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
