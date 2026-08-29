import assert from "node:assert/strict";
import test from "node:test";
import type {
  ApprovalRecord,
  ConversationEntry,
  ToolCallRecord,
} from "@nervekit/contracts";
import { ApprovalBatchResolutionService } from "../../src/domains/human-input/approval-batch-resolution.js";
import type {
  ApprovalInteractionBatch,
  WorkbenchRunService,
} from "../../src/domains/runs/application/workbench-run.service.js";
import type { ToolService } from "../../src/domains/tools/execution/tool-service.js";

function terminalToolCall(id: string): ToolCallRecord {
  return {
    id,
    agentId: "agent_test",
    conversationId: "conv_test",
    projectId: "proj_test",
    runId: "run_test",
    toolName: "bash",
    risk: "high",
    args: {},
    cwd: "/tmp",
    status: "denied",
    revision: 2,
    attempt: 0,
    interactions: [],
    error: "Denied by user.",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:01.000Z",
    settledAt: "2026-01-01T00:00:01.000Z",
  } as unknown as ToolCallRecord;
}

test("startup recovery loads evicted terminal approval tool calls asynchronously", async () => {
  const decided = terminalToolCall("tool_decided");
  const policyTerminal = terminalToolCall("tool_policy_terminal");
  const approval = {
    id: "approval_decided_0",
    toolCallId: decided.id,
    status: "denied",
  } as unknown as ApprovalRecord;
  const batch = {
    runId: "run_test",
    checkpointId: "checkpoint_test",
    batchToolCallIds: [decided.id, policyTerminal.id],
    interactions: [
      {
        id: "interaction_test",
        toolCallId: decided.id,
        status: "pending",
      },
    ],
  } as unknown as ApprovalInteractionBatch;

  const canonicalLoads: string[] = [];
  let resolutions = 0;
  const tools = {
    listApprovals: () => [approval],
    getToolCall: () => {
      throw new Error("Tool call is not active; load it asynchronously.");
    },
    getToolCallDetails: async (toolCallId: string) => {
      canonicalLoads.push(toolCallId);
      return toolCallId === decided.id ? decided : policyTerminal;
    },
    finalizeDecidedApproval: async () => decided,
  } as unknown as ToolService;
  const runs = {
    approvalBatchForToolCall: async () => batch,
    assertApprovalBatchContextUnchanged: async () => undefined,
    resolveInteractionBatchForToolCalls: async () => {
      resolutions += 1;
    },
  } as unknown as WorkbenchRunService;
  const service = new ApprovalBatchResolutionService({
    tools,
    runs,
    appendToolResult: async () => ({}) as ConversationEntry,
    existingToolResultEntry: () => undefined,
  });

  await service.recoverReadyBatches();

  assert.equal(resolutions, 1);
  assert.ok(canonicalLoads.includes(decided.id));
  assert.ok(canonicalLoads.includes(policyTerminal.id));
});
