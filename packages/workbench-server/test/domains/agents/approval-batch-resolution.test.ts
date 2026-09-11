import assert from "node:assert/strict";
import test from "node:test";
import type { ApprovalRecord, ToolCallRecord } from "@nervekit/contracts/tools";
import type { ConversationEntry } from "@nervekit/contracts/conversations";
import { ApplicationError } from "../../../src/core/application-error.js";
import { ApprovalBatchResolutionService } from "../../../src/domains/human-input/approval-batch-resolution.js";
import type {
  ApprovalInteractionBatch,
  WorkbenchRunService,
} from "../../../src/domains/runs/application/workbench-run.service.js";
import type { ToolService } from "../../../src/domains/tools/execution/tool-service.js";

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

test("approval decision atomically commits a durable reconciliation intent", async () => {
  const pending = {
    ...terminalToolCall("tool_decided"),
    status: "waiting",
    revision: 1,
    settledAt: undefined,
  } as ToolCallRecord;
  const approval = {
    id: "approval_decided_0",
    toolCallId: pending.id,
    conversationId: pending.conversationId,
    status: "pending",
  } as unknown as ApprovalRecord;
  const otherApproval = {
    id: "approval_other_0",
    toolCallId: "tool_other",
    status: "pending",
  } as unknown as ApprovalRecord;
  let command: { work: Array<{ kind: string }>; events: unknown[] } | undefined;
  const tools = {
    listApprovals: () => [approval],
    getToolCall: () => pending,
    decideApproval: async (
      _id: string,
      _decision: string,
      _note: string | undefined,
      _requestId: string | undefined,
      _scope: string | undefined,
      commit: (
        next: ToolCallRecord,
        events: Array<{ kind: "tool_call.upserted" }>,
      ) => Promise<void>,
    ) => {
      await commit(pending, [{ kind: "tool_call.upserted" }]);
      return { ...approval, status: "granted" };
    },
    getApprovalForToolCallDetails: async (toolCallId: string) =>
      toolCallId === pending.id
        ? ({ ...approval, status: "granted" } as ApprovalRecord)
        : otherApproval,
  } as unknown as ToolService;
  const batch = {
    runId: "run_test",
    checkpointId: "checkpoint_test",
    batchToolCallIds: [pending.id, "tool_other"],
  } as unknown as ApprovalInteractionBatch;
  const runs = {
    approvalBatchForToolCall: async () => batch,
    assertPendingInteractionForToolCall: async () => undefined,
  } as unknown as WorkbenchRunService;
  const service = new ApprovalBatchResolutionService({
    tools,
    runs,
    lifecycle: {
      commit: async (input: typeof command) => {
        command = input;
        return { replayed: false, outcome: {} };
      },
    } as never,
    appendToolResult: async () => ({}) as ConversationEntry,
    existingToolResultEntry: async () => undefined,
  });

  await service.resolve(approval.id, "allow", undefined, "request_test");
  assert.equal(command?.work[0]?.kind, "reconcile_conversation");
  assert.deepEqual(command?.events, [{ kind: "tool_call.upserted" }]);
});

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
  let finalizations = 0;
  const tools = {
    listApprovals: (status?: ApprovalRecord["status"]) =>
      status === "pending" ? [] : [approval],
    getToolCall: () => {
      throw new Error("Tool call is not active; load it asynchronously.");
    },
    getToolCallDetails: async (toolCallId: string) => {
      canonicalLoads.push(toolCallId);
      return toolCallId === decided.id ? decided : policyTerminal;
    },
    getApprovalForToolCallDetails: async (toolCallId: string) =>
      toolCallId === decided.id ? approval : undefined,
    finalizeDecidedApproval: async () => {
      finalizations += 1;
      return decided;
    },
  } as unknown as ToolService;
  const runs = {
    listPendingApprovalInteractions: async () => batch.interactions,
    recoverableApprovalBatchForToolCall: async () => batch,
    assertApprovalBatchRecoveryContextUnchanged: async () => undefined,
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
  assert.equal(finalizations, 0, "terminal tools must not execute again");
  assert.ok(canonicalLoads.includes(decided.id));
  assert.ok(canonicalLoads.includes(policyTerminal.id));
});

for (const code of [
  "RUN_CHECKPOINT_STALE",
  "RUN_TOOL_REVISION_STALE",
] as const) {
  test(`startup recovery cancels a stale approval batch for ${code} without executing tools`, async () => {
    const decided = {
      ...terminalToolCall("tool_decided"),
      status: "approved",
      settledAt: undefined,
    } as unknown as ToolCallRecord;
    const approval = {
      id: "approval_decided_0",
      toolCallId: decided.id,
      status: "granted",
    } as unknown as ApprovalRecord;
    const batch = {
      runId: "run_test",
      checkpointId: "checkpoint_test",
      batchToolCallIds: [decided.id],
      interactions: [
        {
          id: "interaction_test",
          toolCallId: decided.id,
          status: "pending",
        },
      ],
    } as unknown as ApprovalInteractionBatch;
    let finalizations = 0;
    let appended = 0;
    let resolutions = 0;
    let cancellations = 0;
    const warnings: Array<{ message: string; context: unknown }> = [];
    const tools = {
      listApprovals: (status?: ApprovalRecord["status"]) =>
        status === "pending" ? [] : [approval],
      getToolCallDetails: async () => decided,
      getApprovalForToolCallDetails: async () => approval,
      finalizeDecidedApproval: async () => {
        finalizations += 1;
        return terminalToolCall(decided.id);
      },
    } as unknown as ToolService;
    const runs = {
      listPendingApprovalInteractions: async () => batch.interactions,
      recoverableApprovalBatchForToolCall: async () => batch,
      assertApprovalBatchRecoveryContextUnchanged: async () => {
        throw new ApplicationError(409, code, "stale");
      },
      cancelStaleApprovalBatch: async () => {
        cancellations += 1;
        return {
          outcome: "cancelled",
          run: {
            runId: batch.runId,
            conversationId: "conv_test",
            agentId: "agent_test",
            status: "cancelled",
          },
        };
      },
      resolveInteractionBatchForToolCalls: async () => {
        resolutions += 1;
      },
    } as unknown as WorkbenchRunService;
    const service = new ApprovalBatchResolutionService({
      tools,
      runs,
      logger: {
        warn: async (message: string, context: unknown) => {
          warnings.push({ message, context });
        },
      } as never,
      appendToolResult: async () => {
        appended += 1;
        return {} as ConversationEntry;
      },
      existingToolResultEntry: () => undefined,
    });

    await service.recoverReadyBatches();

    assert.equal(cancellations, 1);
    assert.equal(finalizations, 0);
    assert.equal(appended, 0);
    assert.equal(resolutions, 0);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0]!.message, /no tools were executed/);
    assert.deepEqual(
      (warnings[0]!.context as { context: { errorCode: string } }).context
        .errorCode,
      code,
    );
  });
}

test("startup recovery propagates unexpected context validation failures", async () => {
  const decided = {
    ...terminalToolCall("tool_decided"),
    status: "approved",
    settledAt: undefined,
  } as unknown as ToolCallRecord;
  const approval = {
    id: "approval_decided_0",
    toolCallId: decided.id,
    status: "denied",
  } as unknown as ApprovalRecord;
  const batch = {
    runId: "run_test",
    checkpointId: "checkpoint_test",
    batchToolCallIds: [decided.id],
    interactions: [
      { id: "interaction_test", toolCallId: decided.id, status: "pending" },
    ],
  } as unknown as ApprovalInteractionBatch;
  const service = new ApprovalBatchResolutionService({
    tools: {
      listApprovals: (status?: ApprovalRecord["status"]) =>
        status === "pending" ? [] : [approval],
      getToolCallDetails: async () => decided,
      getApprovalForToolCallDetails: async () => approval,
    } as unknown as ToolService,
    runs: {
      listPendingApprovalInteractions: async () => batch.interactions,
      recoverableApprovalBatchForToolCall: async () => batch,
      assertApprovalBatchRecoveryContextUnchanged: async () => {
        throw new Error("storage unavailable");
      },
    } as unknown as WorkbenchRunService,
    appendToolResult: async () => ({}) as ConversationEntry,
    existingToolResultEntry: () => undefined,
  });

  await assert.rejects(service.recoverReadyBatches(), /storage unavailable/);
});
