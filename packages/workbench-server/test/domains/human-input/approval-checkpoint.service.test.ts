import assert from "node:assert/strict";
import test from "node:test";
import type {
  LifecycleWork,
  RecoveryIssue,
  RunInteractionRecord,
} from "@nervekit/contracts/runs";
import type { ToolCallRecord } from "@nervekit/contracts/tools";
import { ApplicationError } from "../../../src/core/application-error.js";
import { ApprovalCheckpointService } from "../../../src/domains/human-input/approval-checkpoint.service.js";
import {
  PreDispatchError,
  ToolExecutionAlreadyClaimedError,
} from "../../../src/domains/tools/execution/tool-execution-claim.js";

const now = "2026-01-01T00:00:00.000Z";
const checkpointId = "checkpoint_test";
const members = ["tool_ready", "tool_lost", "tool_unknown"];

function toolCall(
  id: string,
  overrides: Partial<ToolCallRecord> = {},
): ToolCallRecord {
  return {
    id,
    conversationId: "conv_test",
    runId: "run_test",
    status: "committed",
    interactions: [
      {
        ordinal: 0,
        kind: "approval",
        status: "resolved",
        resolutionRequestId: `legacy_${id}`,
        resolution: { action: "allow" },
      },
    ],
    ...overrides,
  } as unknown as ToolCallRecord;
}

function interaction(
  toolCallId: string,
  status: RunInteractionRecord["status"],
): RunInteractionRecord {
  return {
    id: `interaction_${toolCallId}`,
    runId: "run_test",
    toolCallId,
    interactionOrdinal: 0,
    toolCallRevision: 2,
    batchToolCallIds: members,
    kind: "approval",
    status,
    checkpointId,
    createdAt: now,
    ...(status === "resolved" ? { resolution: { decision: "allow" } } : {}),
  } as unknown as RunInteractionRecord;
}

function work(
  proposalId: string,
  state: LifecycleWork["state"],
): LifecycleWork {
  return {
    id: `work_${proposalId}`,
    deduplicationKey: `approval:${proposalId}`,
    conversationId: "conv_test",
    runId: "run_test",
    proposalId,
    kind: "execute_tool",
    state,
    inputHash: `sha256:${"a".repeat(64)}`,
    generation: 1,
    attemptCount: 1,
    notBefore: now,
    createdAt: now,
    updatedAt: now,
  };
}

function harness(input: {
  status: string;
  interactions: RunInteractionRecord[];
  toolCalls: Record<string, ToolCallRecord>;
  work?: LifecycleWork[];
  claim?: () => Promise<ToolCallRecord>;
  stale?: boolean;
}) {
  const state = {
    run: {
      runId: "run_test",
      conversationId: "conv_test",
      status: input.status,
      revision: 3,
      lastCheckpointId: checkpointId,
    },
    interactions: input.interactions,
    checkpoints: [],
  };
  const decisions: unknown[] = [];
  const issues: RecoveryIssue[] = [];
  const settledBeforeDispatch: Array<[string, string]> = [];
  const service = new ApprovalCheckpointService({
    tools: {
      getToolCallDetails: async (id: string) => input.toolCalls[id],
      claimApprovedExecution:
        input.claim ??
        (async () => {
          throw new Error("unexpected claim");
        }),
      settleBeforeDispatch: async (id: string, status: string) => {
        settledBeforeDispatch.push([id, status]);
        return input.toolCalls[id];
      },
    } as never,
    runs: {
      listApprovalCheckpointRuns: async () => [state],
      loadRunState: async () => state,
      recordApprovalDecision: async (
        _runId: string,
        command: {
          toolCallId: string;
          releaseWork: boolean;
        },
      ) => {
        decisions.push(command);
        state.interactions = state.interactions.map((item) =>
          item.toolCallId === command.toolCallId
            ? interaction(item.toolCallId, "resolved")
            : item,
        );
        if (state.interactions.every((item) => item.status === "resolved")) {
          state.run.status = "executing_tools";
        }
        return { run: state.run, checkpointId, replayed: false };
      },
      assertCheckpointOnActiveBranch: async () => {
        if (input.stale) {
          throw new ApplicationError(
            409,
            "RUN_CHECKPOINT_STALE",
            "Branch moved.",
          );
        }
      },
      cancelStaleApprovalCheckpoint: async () => {
        state.run.status = "cancelled";
      },
    } as never,
    lifecycle: {} as never,
    work: {
      listLifecycleWorkForRun: async () => input.work ?? [],
      listRecoveryIssues: async () => issues,
      persistRecoveryIssue: async (issue: RecoveryIssue) => {
        issues.push(issue);
      },
    },
    notifyWork: () => undefined,
    appendToolResult: async () => {
      throw new Error("unexpected append");
    },
    existingToolResultEntry: async () => undefined,
  });
  return { service, state, decisions, issues, settledBeforeDispatch };
}

test("legacy tool-only decisions are backfilled without creating or requeuing work", async () => {
  const fixture = harness({
    status: "waiting",
    interactions: members.map((id) => interaction(id, "pending")),
    toolCalls: {
      tool_ready: toolCall("tool_ready"),
      tool_lost: toolCall("tool_lost"),
      tool_unknown: toolCall("tool_unknown", { status: "running" }),
    },
    work: [
      work("tool_ready", "ready"),
      { ...work("tool_lost", "failed"), lastError: "Approval not found." },
      work("tool_unknown", "outcome_unknown"),
    ],
  });

  assert.equal(await fixture.service.backfillLegacyCheckpoints(), 3);

  assert.equal(fixture.state.run.status, "executing_tools");
  assert.ok(
    fixture.decisions.every(
      (decision) =>
        (decision as { releaseWork: boolean }).releaseWork === false,
    ),
  );
  assert.deepEqual(
    fixture.issues.map((issue) => [issue.proposalId, issue.code]),
    [
      ["tool_lost", "conflicting_state"],
      ["tool_unknown", "outcome_unknown"],
    ],
  );
  // A repeated startup adds no duplicate issues.
  await fixture.service.backfillLegacyCheckpoints();
  assert.equal(fixture.issues.length, 2);
});

test("a missing run approval is a typed pre-dispatch failure, never an unknown outcome", async () => {
  const fixture = harness({
    status: "executing_tools",
    interactions: [interaction("tool_ready", "resolved")],
    toolCalls: { tool_ready: toolCall("tool_ready") },
    claim: async () => {
      throw new PreDispatchError("not_approved", "No durable approval.");
    },
  });

  const result = await fixture.service.executeWork(
    work("tool_ready", "leased"),
  );

  assert.equal(result.state, "failed");
  assert.equal(result.failurePhase, "pre_dispatch");
  assert.deepEqual(fixture.settledBeforeDispatch, [["tool_ready", "failed"]]);
});

test("stale context cancels before dispatch", async () => {
  const fixture = harness({
    status: "executing_tools",
    interactions: [interaction("tool_ready", "resolved")],
    toolCalls: { tool_ready: toolCall("tool_ready") },
    claim: async () => {
      throw new PreDispatchError("stale_context", "Branch moved.");
    },
  });

  const result = await fixture.service.executeWork(
    work("tool_ready", "leased"),
  );

  assert.equal(result.state, "cancelled");
  assert.equal(result.failurePhase, "pre_dispatch");
  assert.deepEqual(fixture.settledBeforeDispatch, [
    ["tool_ready", "cancelled"],
  ]);
});

test("a repeated attempt never dispatches a tool that may already have run", async () => {
  const running = toolCall("tool_ready", { status: "running" });
  const fixture = harness({
    status: "executing_tools",
    interactions: [interaction("tool_ready", "resolved")],
    toolCalls: { tool_ready: running },
    claim: async () => {
      throw new ToolExecutionAlreadyClaimedError(running);
    },
  });

  const result = await fixture.service.executeWork(
    work("tool_ready", "leased"),
  );

  assert.equal(result.state, "outcome_unknown");
  assert.equal(result.failurePhase, "post_dispatch");
});

test("an already cancelled post-claim member is not mistaken for proven execution", async () => {
  const cancelled = toolCall("tool_ready", {
    status: "cancelled",
    error: "External outcome is unknown.",
    errorDetails: {
      code: "TOOL_OUTCOME_UNKNOWN",
      message: "External outcome is unknown.",
    },
  });
  const fixture = harness({
    status: "cancelled",
    interactions: [interaction("tool_ready", "resolved")],
    toolCalls: { tool_ready: cancelled },
    claim: async () => {
      throw new ToolExecutionAlreadyClaimedError(cancelled);
    },
  });
  const result = await fixture.service.executeWork(
    work("tool_ready", "leased"),
  );
  assert.equal(result.state, "outcome_unknown");
  assert.equal(result.failurePhase, "post_dispatch");
});

test("stale released checkpoint fences unclaimed siblings but preserves running ones", async () => {
  const fixture = harness({
    status: "executing_tools",
    stale: true,
    interactions: members.map((id) => interaction(id, "resolved")),
    toolCalls: {
      tool_ready: toolCall("tool_ready", { status: "completed" }),
      tool_lost: toolCall("tool_lost", { status: "running" }),
      tool_unknown: toolCall("tool_unknown"),
    },
    work: [work("tool_lost", "leased"), work("tool_unknown", "ready")],
  });
  await fixture.service.reconcileAll();
  assert.deepEqual(fixture.settledBeforeDispatch, [
    ["tool_unknown", "cancelled"],
  ]);
  assert.equal(fixture.state.run.status, "executing_tools");
});

test("a fully settled stale checkpoint cancels its run without appending results", async () => {
  const fixture = harness({
    status: "executing_tools",
    stale: true,
    interactions: members.map((id) => interaction(id, "resolved")),
    toolCalls: Object.fromEntries(
      members.map((id) => [id, toolCall(id, { status: "completed" })]),
    ),
  });
  assert.equal(
    await fixture.service.reconcileCheckpoint("run_test"),
    "cancelled",
  );
  assert.equal(fixture.state.run.status, "cancelled");
});

test("resolving a checkpoint that is still executing is refused", async () => {
  const fixture = harness({
    status: "executing_tools",
    interactions: [interaction("tool_ready", "resolved")],
    toolCalls: {
      tool_ready: toolCall("tool_ready"),
      tool_lost: toolCall("tool_lost", { status: "completed" }),
      tool_unknown: toolCall("tool_unknown", { status: "completed" }),
    },
    work: [work("tool_ready", "leased")],
  });

  await assert.rejects(
    fixture.service.resolveBlockedCheckpoint("run_test"),
    (error: unknown) =>
      error instanceof ApplicationError && error.code === "RUN_EXECUTING_TOOLS",
  );
});
