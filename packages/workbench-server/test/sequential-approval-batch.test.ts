import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ToolResultMessage } from "@earendil-works/pi-ai";
import type {
  AgentRecord,
  ApprovalRecord,
  ConversationEntry,
  RunInteractionRecord,
  ToolCallRecord,
} from "@nervekit/contracts";
import { waitForSequentialToolApprovalBatch } from "../src/domains/agents/run/sequential-tool-approval-batch.js";
import { HumanInputResolutionService } from "../src/domains/human-input/human-input-resolution.service.js";
import type { ApprovalInteractionBatch } from "../src/domains/runs/workbench-run.service.js";

describe("sequential approval batches", () => {
  it("durably stages every sequential call before creating shared waits", async () => {
    const primary = toolCall("tool_first", "provider_first");
    const staged = toolCall("tool_second", "provider_second");
    const approvals = [
      approval("approval_first", primary.id, "pending"),
      approval("approval_second", staged.id, "pending"),
    ];
    const sequence: string[] = [];
    const waitBatches: Array<
      readonly { toolCallId: string; batchToolCallIds?: readonly string[] }[]
    > = [];
    const requestOptions: Array<Record<string, unknown>> = [];

    await waitForSequentialToolApprovalBatch({
      agent: testAgent,
      runId: "run_batch",
      suspension: {
        toolCallId: primary.id,
        toolName: primary.toolName,
        reason: "Approval required",
        remainingToolCalls: [
          {
            type: "toolCall",
            id: "provider_second",
            name: "jira_create_issue",
            arguments: { summary: "Second" },
          },
        ],
      },
      deps: {
        tools: {
          getToolCall: () => primary,
          requestTool: async (
            _agent: AgentRecord,
            _toolName: string,
            _args: Record<string, unknown>,
            options: Record<string, unknown>,
          ) => {
            sequence.push("stage");
            requestOptions.push(options);
            return { toolCall: staged, approval: approvals[1] };
          },
          listApprovals: () => approvals,
          listUserQuestions: () => [],
        },
        plans: { listPlanReviews: () => [] },
        state: {
          conversationRuntime: {
            resolveToolAnchor: (
              _runId: string,
              providerToolCallId: string,
            ) => ({
              runId: "run_batch",
              turnId: "turn_batch",
              liveMessageId: "msg_batch",
              contentIndex: 2,
              providerToolCallId,
            }),
          },
        },
      } as never,
      sink: {
        upsertToolCalls: async () => undefined,
        waitMany: async (commands: readonly never[]) => {
          waitBatches.push(commands);
          return [];
        },
      } as never,
      checkpointCommand: async () => {
        sequence.push("checkpoint");
        return {
          boundary: "suspension",
          transcriptCursor: 0,
          entryIds: [],
          harnessLeafId: null,
          harnessSavePointId: "save_batch",
          toolCalls: [],
        };
      },
    });

    assert.deepEqual(sequence, ["stage", "checkpoint"]);
    assert.equal(requestOptions[0]?.forceApproval, true);
    assert.equal(requestOptions[0]?.providerToolCallId, "provider_second");
    assert.deepEqual(requestOptions[0]?.anchor, {
      runId: "run_batch",
      turnId: "turn_batch",
      liveMessageId: "msg_batch",
      contentIndex: 2,
      providerToolCallId: "provider_second",
    });
    assert.deepEqual(
      waitBatches[0]?.map((command) => command.toolCallId),
      ["tool_first", "tool_second"],
    );
    assert.deepEqual(waitBatches[0]?.[0]?.batchToolCallIds, [
      "tool_first",
      "tool_second",
    ]);
  });

  it("collects decisions out of order and drains in assistant order once", async () => {
    const fixture = approvalBatchFixture();

    const second = await fixture.service.resolveApproval(
      "approval_second",
      "allow",
    );
    assert.equal(second.status, "pending_approval");
    assert.deepEqual(fixture.finalized, []);
    assert.equal(fixture.resolutions.length, 0);

    const first = await fixture.service.resolveApproval(
      "approval_first",
      "allow",
    );
    assert.equal(first.status, "completed");
    assert.deepEqual(fixture.finalized, ["tool_first", "tool_second"]);
    assert.deepEqual(
      fixture.entries.map(
        (entry) => (entry.details as { toolRecordId?: string }).toolRecordId,
      ),
      ["tool_first", "tool_second"],
    );
    assert.equal(fixture.resolutions.length, 1);
    assert.deepEqual(
      fixture.resolutions[0]?.members.map(
        (member: { interaction: RunInteractionRecord }) =>
          member.interaction.toolCallId,
      ),
      ["tool_first", "tool_second"],
    );
  });

  it("continues past an execution error and a denial", async () => {
    const fixture = approvalBatchFixture({ firstExecutionErrors: true });

    await fixture.service.resolveApproval("approval_first", "allow");
    const denied = await fixture.service.resolveApproval(
      "approval_second",
      "deny",
      "declined",
    );

    assert.equal(denied.status, "denied");
    assert.deepEqual(fixture.finalized, ["tool_first", "tool_second"]);
    assert.deepEqual(
      fixture.entries.map(
        (entry) => (entry.details as { isError?: boolean }).isError,
      ),
      [true, true],
    );
    assert.deepEqual(
      fixture.messages.map((message) => message.toolCallId),
      ["provider_first", "provider_second"],
    );
    assert.deepEqual(
      fixture.messages.map((message) => message.isError),
      [true, true],
    );
    const failedText = toolResultMessageText(fixture.messages[0]!);
    assert.match(failedText, /^Tool execution failed\./);
    assert.match(failedText, /Error: execution failed/);
    assert.doesNotMatch(failedText, /Tool completed\./);
    const deniedText = toolResultMessageText(fixture.messages[1]!);
    assert.match(deniedText, /^User denied the requested tool call\./);
    assert.match(deniedText, /Reason: declined/);
    assert.doesNotMatch(deniedText, /Tool completed\./);
    assert.equal(fixture.resolutions.length, 1);
  });

  it("recovers a fully decided but undrained batch idempotently", async () => {
    const fixture = approvalBatchFixture({ decided: true });

    await fixture.service.recoverReadyApprovalBatches();
    await fixture.service.recoverReadyApprovalBatches();

    assert.deepEqual(fixture.finalized, ["tool_first", "tool_second"]);
    assert.equal(fixture.resolutions.length, 1);
    assert.equal(fixture.entries.length, 2);
  });
});

function approvalBatchFixture(
  options: { firstExecutionErrors?: boolean; decided?: boolean } = {},
) {
  const batchToolCallIds = ["tool_first", "tool_second"];
  const tools = new Map<string, ToolCallRecord>([
    ["tool_first", toolCall("tool_first", "provider_first")],
    ["tool_second", toolCall("tool_second", "provider_second")],
  ]);
  const approvals = new Map<string, ApprovalRecord>([
    [
      "approval_first",
      approval(
        "approval_first",
        "tool_first",
        options.decided ? "granted" : "pending",
      ),
    ],
    [
      "approval_second",
      approval(
        "approval_second",
        "tool_second",
        options.decided ? "denied" : "pending",
      ),
    ],
  ]);
  const interactions = batchToolCallIds.map((toolCallId, index) =>
    interaction(toolCallId, batchToolCallIds, index),
  );
  const batch: ApprovalInteractionBatch = {
    runId: "run_batch",
    checkpointId: "checkpoint_batch",
    batchToolCallIds,
    interactions,
  };
  const finalized: string[] = [];
  const entries: ConversationEntry[] = [];
  const resolutions: Array<{
    members: readonly unknown[];
    entries: readonly ConversationEntry[];
  }> = [];
  const messages: ToolResultMessage[] = [];
  let resolved = false;
  let entryOrdinal = 0;

  const service = new HumanInputResolutionService({
    tools: {
      listApprovals: () => [...approvals.values()],
      getToolCall: (toolCallId: string) => tools.get(toolCallId)!,
      decideApproval: async (
        approvalId: string,
        decision: "allow" | "deny",
        note?: string,
      ) => {
        const current = approvals.get(approvalId)!;
        const decided: ApprovalRecord = {
          ...current,
          status: decision === "allow" ? "granted" : "denied",
          resolvedAt: "2026-07-17T00:00:01.000Z",
          resolutionNote: note,
        };
        approvals.set(approvalId, decided);
        return decided;
      },
      finalizeDecidedApproval: async (approvalId: string) => {
        const current = approvals.get(approvalId)!;
        const tool = tools.get(current.toolCallId)!;
        if (["completed", "denied", "error"].includes(tool.status)) {
          return tool;
        }
        finalized.push(tool.id);
        const status =
          current.status === "denied"
            ? "denied"
            : tool.id === "tool_first" && options.firstExecutionErrors
              ? "error"
              : "completed";
        const terminal: ToolCallRecord = {
          ...tool,
          status,
          error:
            status === "denied"
              ? (current.resolutionNote ?? "Denied by user.")
              : status === "error"
                ? "execution failed"
                : undefined,
          result: { content: `${tool.id}:${status}` },
          updatedAt: "2026-07-17T00:00:02.000Z",
        };
        tools.set(tool.id, terminal);
        return terminal;
      },
    },
    runs: {
      approvalBatchForToolCall: async () => {
        if (resolved) throw new Error("batch already resolved");
        return batch;
      },
      assertPendingInteractionForToolCall: async () => undefined,
      resolveInteractionBatchForToolCalls: async (input: {
        members: readonly unknown[];
        entries: readonly ConversationEntry[];
      }) => {
        resolutions.push(input);
        resolved = true;
      },
    },
    getAgent: () => testAgent,
    getConversationEntries: () => entries,
    harnessStorage: {
      appendAgentMessage: async (
        _agent: AgentRecord,
        message: ToolResultMessage,
      ) => {
        messages.push(message);
        return {
          id: `entry_${++entryOrdinal}`,
          timestamp: `2026-07-17T00:00:0${entryOrdinal}.000Z`,
        };
      },
    },
    appendEntry: async (input: ConversationEntry) => {
      entries.push(input);
      return input;
    },
  } as never);

  return { service, finalized, entries, messages, resolutions };
}

function toolResultMessageText(message: ToolResultMessage): string {
  return message.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}

function toolCall(id: string, providerToolCallId: string): ToolCallRecord {
  return {
    id,
    agentId: testAgent.id,
    conversationId: testAgent.conversationId,
    projectId: testAgent.projectId,
    runId: "run_batch",
    turnId: "turn_batch",
    providerToolCallId,
    sourceToolCallId: providerToolCallId,
    toolName: "jira_create_issue",
    risk: "network",
    args: { summary: id },
    cwd: "/tmp/project",
    status: "pending_approval",
    approvalId: id === "tool_first" ? "approval_first" : "approval_second",
    createdAt: "2026-07-17T00:00:00.000Z",
    updatedAt: "2026-07-17T00:00:00.000Z",
  };
}

function approval(
  id: string,
  toolCallId: string,
  status: ApprovalRecord["status"],
): ApprovalRecord {
  return {
    id,
    toolCallId,
    agentId: testAgent.id,
    conversationId: testAgent.conversationId,
    projectId: testAgent.projectId,
    risk: "network",
    reason: "Supervised mutation",
    status,
    requestedAt: "2026-07-17T00:00:00.000Z",
    resolvedAt: status === "pending" ? undefined : "2026-07-17T00:00:01.000Z",
  };
}

function interaction(
  toolCallId: string,
  batchToolCallIds: string[],
  index: number,
): RunInteractionRecord {
  return {
    stateEpoch: 1,
    id: `interaction_${index}`,
    conversationId: testAgent.conversationId,
    agentId: testAgent.id,
    projectId: testAgent.projectId,
    runId: "run_batch",
    executionId: "exec_batch",
    toolCallId,
    batchToolCallIds,
    prompt: "Approve",
    status: "pending",
    checkpointId: "checkpoint_batch",
    createdAt: `2026-07-17T00:00:0${index}.000Z`,
    kind: "approval",
    risk: ["network"],
    normalizedArgs: {},
    offeredScopes: ["single_call"],
  };
}

const testAgent: AgentRecord = {
  id: "agent_batch",
  conversationId: "conv_batch",
  projectId: "proj_batch",
  projectDir: "/tmp/project",
  workerId: "worker_batch",
  rootAgentId: "agent_batch",
  mode: "coding",
  permissionLevel: "supervised",
  workspaceScope: { roots: ["/tmp/project"] },
  budget: { depth: 0, maxDepth: 3, maxRuns: 8, usedRuns: 0 },
  status: "waiting_for_approval",
  createdAt: "2026-07-17T00:00:00.000Z",
  updatedAt: "2026-07-17T00:00:00.000Z",
};
