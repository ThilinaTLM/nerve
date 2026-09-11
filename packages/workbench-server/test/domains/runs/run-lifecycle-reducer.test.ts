import assert from "node:assert/strict";
import test from "node:test";
import type {
  LifecycleInteraction,
  LifecycleWork,
  RunLifecycleRecord,
  ToolProposal,
} from "@nervekit/contracts/runs";
import {
  assertRunLifecycleInvariants,
  projectRunActivity,
  type RunLifecycleAggregate,
} from "../../../src/domains/runs/runtime/run-lifecycle-reducer.js";

const now = "2026-01-01T00:00:00.000Z";
const run: RunLifecycleRecord = {
  runId: "run_test",
  conversationId: "conv_test",
  projectId: "proj_test",
  agentId: "agent_test",
  branchEpoch: 1,
  revision: 1,
  state: "open",
  createdAt: now,
  updatedAt: now,
};
const proposal: ToolProposal = {
  id: "proposal_test",
  conversationId: run.conversationId,
  projectId: run.projectId,
  agentId: run.agentId,
  runId: run.runId,
  executionId: "exec_test",
  batchId: "batch_test",
  toolName: "bash",
  providerToolCallId: "provider_test",
  argumentsHash: `sha256:${"a".repeat(64)}`,
  contextFingerprint: `sha256:${"b".repeat(64)}`,
  replayCapability: "non_replayable",
  createdAt: now,
};

function aggregate(
  input: Partial<RunLifecycleAggregate> = {},
): RunLifecycleAggregate {
  return {
    run,
    proposals: [proposal],
    interactions: [],
    attempts: [],
    work: [],
    recoveryIssues: [],
    ...input,
  };
}

function pendingApproval(): LifecycleInteraction {
  return {
    id: "interaction_test",
    proposalId: proposal.id,
    runId: run.runId,
    kind: "approval",
    status: "pending",
    request: {},
    requestedAt: now,
  };
}

function work(
  kind: LifecycleWork["kind"],
  state: LifecycleWork["state"],
): LifecycleWork {
  return {
    id: `work_${kind}`,
    deduplicationKey: `${run.runId}:${kind}`,
    conversationId: run.conversationId,
    runId: run.runId,
    kind,
    state,
    inputHash: `sha256:${"c".repeat(64)}`,
    generation: 0,
    attemptCount: 0,
    notBefore: now,
    ...(state === "leased"
      ? { leaseOwner: "boot_test", leaseDeadline: now }
      : {}),
    createdAt: now,
    updatedAt: now,
  };
}

test("activity derives awaiting input from the authoritative interaction", () => {
  const view = projectRunActivity(
    aggregate({
      interactions: [pendingApproval()],
      work: [work("continue_model", "ready")],
    }),
  );
  assert.equal(view.phase, "awaiting_input");
  assert.equal(view.actionableInteractions.length, 1);
});

test("recovery issues take precedence over pending input", () => {
  const view = projectRunActivity(
    aggregate({
      interactions: [pendingApproval()],
      recoveryIssues: [
        {
          id: "recovery_test",
          conversationId: run.conversationId,
          runId: run.runId,
          code: "outcome_unknown",
          message: "Execution outcome is unknown.",
          actions: ["inspect", "cancel_run"],
          createdAt: now,
        },
      ],
    }),
  );
  assert.equal(view.phase, "recovery_required");
});

test("a terminal run cannot retain pending input", () => {
  assert.throws(
    () =>
      assertRunLifecycleInvariants(
        aggregate({
          run: { ...run, state: "completed", terminalAt: now },
          interactions: [pendingApproval()],
        }),
      ),
    /terminal run cannot have pending interactions/,
  );
});

test("active work is unique by logical deduplication key", () => {
  const first = work("execute_tool", "ready");
  assert.throws(
    () =>
      assertRunLifecycleInvariants(
        aggregate({
          work: [
            first,
            {
              ...first,
              id: "work_duplicate",
              state: "leased",
              leaseOwner: "boot",
              leaseDeadline: now,
            },
          ],
        }),
      ),
    /Multiple active work items/,
  );
});
