import assert from "node:assert/strict";
import test from "node:test";
import type { AgentToolSuspensionData } from "@nervekit/harness/agent";
import type { AgentRecord } from "@nervekit/contracts/agents";
import type { ToolCallRecord } from "@nervekit/contracts/tools";
import { waitForSequentialToolInteractionBatch } from "../../../src/domains/agents/execution/sequential-tool-approval-batch.js";
import type { WorkbenchAgentMechanics } from "../../../src/domains/agents/execution/workbench-agent-mechanics.js";
import type {
  CheckpointCommand,
  RunExecutionSink,
  WaitCommand,
} from "../../../src/domains/runs/runtime/index.js";
import type { ToolRequestOptions } from "../../../src/domains/tools/execution/tool-service.js";

type RemainingCall = { id: string; name: string; arguments: unknown };

function pendingWaitRecord(
  id: string,
  toolName: string,
  kind: "approval" | "user_input",
): ToolCallRecord {
  return {
    id,
    agentId: "agent_test",
    conversationId: "conv_test",
    projectId: "proj_test",
    toolName,
    risk: "low",
    args: {},
    cwd: "/tmp",
    status: "waiting",
    revision: 1,
    attempt: 0,
    interactions: [{ kind, ordinal: 0, status: "pending" }],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  } as unknown as ToolCallRecord;
}

function runBatch(options: {
  primary: ToolCallRecord;
  remaining: RemainingCall[];
}) {
  const requested: Array<{
    toolName: string;
    args: unknown;
    options: ToolRequestOptions;
  }> = [];
  const waits: WaitCommand[] = [];
  let stagedIndex = 0;

  const tools = {
    getToolCall: () => options.primary,
    requestTool: async (
      _agent: AgentRecord,
      toolName: string,
      args: unknown,
      requestOptions: ToolRequestOptions,
    ) => {
      requested.push({ toolName, args, options: requestOptions });
      stagedIndex += 1;
      return {
        toolCall: pendingWaitRecord(
          `tool_staged_${stagedIndex}`,
          toolName,
          "approval",
        ),
      };
    },
    recordProviderToolCallError: async () => ({
      toolCall: pendingWaitRecord("tool_error", "bash", "approval"),
    }),
  };

  const sink = {
    upsertToolCalls: async () => {},
    wait: async (command: WaitCommand) => {
      waits.push(command);
      // @ts-expect-error return type unused by the targeted logic
      return {};
    },
    waitMany: async (commands: readonly WaitCommand[]) => {
      waits.push(...commands);
      // @ts-expect-error return type unused by the targeted logic
      return [];
    },
  } as unknown as RunExecutionSink;

  const deps = {
    tools,
    state: {
      conversationRuntime: { resolveToolAnchor: () => ({}) },
    },
  } as unknown as WorkbenchAgentMechanics["deps"];

  const suspension: AgentToolSuspensionData = {
    toolCallId: options.primary.id,
    toolName: options.primary.toolName,
    reason: "Approval required",
    remainingToolCalls: options.remaining,
  };

  return {
    batchWaitIds(): string[] {
      return waits.map((wait) => wait.toolCallId);
    },
    run: () =>
      waitForSequentialToolInteractionBatch({
        agent: { id: "agent_test" } as unknown as AgentRecord,
        runId: "run_test",
        suspension,
        deps,
        sink,
        checkpointCommand: async () =>
          ({ boundary: "suspension" }) as unknown as CheckpointCommand,
      }),
    requested,
    waits,
  };
}

test("stages parallel tools without overriding their own permission decisions", async () => {
  const primary = pendingWaitRecord("tool_primary", "bash", "approval");
  const batch = runBatch({
    primary,
    remaining: [
      { id: "provider_second", name: "python_exec", arguments: { code: "x" } },
      { id: "provider_third", name: "bash", arguments: { command: "y" } },
    ],
  });

  await batch.run();

  // Both remaining parallel tools are staged and evaluated independently.
  assert.equal(batch.requested.length, 2);
  assert.deepEqual(
    batch.requested.map((r) => r.toolName),
    ["python_exec", "bash"],
  );
  for (const request of batch.requested) {
    assert.equal(request.options.forceApproval, undefined);
  }

  // The primary and every staged call must join one shared wait batch.
  assert.equal(batch.waits.length, 3);
  const ids = batch.batchWaitIds();
  assert.equal(new Set(ids).size, 3);
  assert.ok(ids.includes("tool_primary"));
  for (const wait of batch.waits) {
    assert.deepEqual(new Set(wait.batchToolCallIds), new Set(ids));
  }
});

test("does not force-stage a regular tool alongside an ask_user primary (break preserved)", async () => {
  const primary = pendingWaitRecord("tool_ask", "ask_user", "user_input");
  const batch = runBatch({
    primary,
    remaining: [
      { id: "provider_bash", name: "bash", arguments: { command: "x" } },
    ],
  });

  await batch.run();

  // A non-native (regular approval) tool after an ask_user primary must NOT be staged.
  assert.equal(batch.requested.length, 0);
  assert.equal(batch.waits.length, 1);
  assert.equal(batch.waits[0]!.toolCallId, "tool_ask");
  assert.equal(batch.waits[0]!.batchToolCallIds, undefined);
});

test("stages a native interaction tool alongside an ask_user primary without forcing approval", async () => {
  const primary = pendingWaitRecord("tool_ask", "ask_user", "user_input");
  const batch = runBatch({
    primary,
    remaining: [{ id: "provider_ask2", name: "ask_user", arguments: {} }],
  });

  await batch.run();

  assert.equal(batch.requested.length, 1);
  assert.equal(batch.requested[0]!.options.forceApproval, undefined);
  assert.equal(batch.waits.length, 2);
  assert.ok(batch.batchWaitIds().includes("tool_ask"));
  assert.ok(batch.batchWaitIds().includes("tool_staged_1"));
});
