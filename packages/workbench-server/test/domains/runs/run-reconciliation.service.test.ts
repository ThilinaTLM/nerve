import assert from "node:assert/strict";
import test from "node:test";
import type { ReconcileConversationResult } from "@nervekit/contracts/conversations";

interface TestOperation {
  id: string;
  conversationId: string;
  requestId: string;
  status: "running" | "completed" | "failed";
  result?: ReconcileConversationResult;
  error?: string;
  createdAt: string;
  updatedAt: string;
}
import { RunReconciliationService } from "../../../src/domains/runs/runtime/run-reconciliation.service.js";

test("repeated explicit reconciliation returns one durable operation result", async () => {
  const operations = new Map<string, TestOperation>();
  let recoveries = 0;
  const service = new RunReconciliationService({
    humanInput: {
      recoverReadyApprovalBatches: async () => {
        recoveries += 1;
        return 1;
      },
      recoverAcceptedPlanReviews: async () => 0,
      recoverResolvedUserQuestions: async () => 0,
    },
    tools: {
      getToolCallDetails: async () => ({ status: "completed" }),
      listToolCallPreviews: async () => [
        { interactions: [{ status: "pending" }, { status: "resolved" }] },
      ],
    },
    conversationQuery: {
      getConversationSnapshot: async () => ({ conversationRevision: 12 }),
    },
    operations: operationStore(operations),
    work: emptyWorkStore(),
    operationId: () => "reconcile_test",
    now: () => new Date("2026-01-01T00:00:00.000Z"),
  });

  const [first, coincident] = await Promise.all([
    service.reconcileConversation("conv_test", "request_test"),
    service.reconcileConversation("conv_test", "request_test"),
  ]);
  const replayed = await service.reconcileConversation(
    "conv_test",
    "request_test",
  );

  assert.deepEqual(coincident, first);
  assert.deepEqual(replayed, first);
  assert.equal(first.changed, true);
  assert.equal(first.preservedInputs, 1);
  assert.equal(first.repairedTransitions, 1);
  assert.equal(recoveries, 1);
  assert.equal(operations.size, 1);
});

test("expired unproven tool work becomes an explicit unknown outcome", async () => {
  let settledState: string | undefined;
  const service = new RunReconciliationService({
    humanInput: {
      recoverReadyApprovalBatches: async () => 0,
      recoverAcceptedPlanReviews: async () => 0,
      recoverResolvedUserQuestions: async () => 0,
    },
    tools: {
      getToolCallDetails: async () => ({ status: "running" }),
      listToolCallPreviews: async () => [],
    },
    conversationQuery: {
      getConversationSnapshot: async () => ({ conversationRevision: 4 }),
    },
    operations: operationStore(new Map()),
    work: {
      listExpiredLifecycleWork: async () => [
        {
          id: "work_expired",
          deduplicationKey: "run_test:execute",
          conversationId: "conv_test",
          runId: "run_test",
          proposalId: "tool_test",
          kind: "execute_tool",
          state: "leased",
          inputHash: `sha256:${"a".repeat(64)}`,
          generation: 1,
          attemptCount: 1,
          notBefore: "2026-01-01T00:00:00.000Z",
          leaseOwner: "boot_old",
          leaseDeadline: "2026-01-01T00:00:30.000Z",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      settleLifecycleWork: async (input) => {
        settledState = input.state;
        return undefined;
      },
    },
    operationId: () => "reconcile_test",
    now: () => new Date("2026-01-01T00:01:00.000Z"),
  });

  const result = await service.reconcileConversation(
    "conv_test",
    "request_test",
  );
  assert.equal(settledState, "outcome_unknown");
  assert.equal(result.unknownOutcomes, 1);
  assert.equal(result.recoveryIssues[0]?.code, "outcome_unknown");
});

test("startup and explicit refresh invoke the same recovery rules", async () => {
  const scopes: Array<string | undefined> = [];
  const service = new RunReconciliationService({
    humanInput: {
      recoverReadyApprovalBatches: async (conversationId) => {
        scopes.push(conversationId);
        return 0;
      },
      recoverAcceptedPlanReviews: async (conversationId) => {
        scopes.push(conversationId);
        return 0;
      },
      recoverResolvedUserQuestions: async (conversationId) => {
        scopes.push(conversationId);
        return 0;
      },
    },
    tools: {
      getToolCallDetails: async () => ({ status: "completed" }),
      listToolCallPreviews: async () => [],
    },
    conversationQuery: {
      getConversationSnapshot: async () => ({ conversationRevision: 1 }),
    },
    operations: operationStore(new Map()),
    work: emptyWorkStore(),
    operationId: () => "reconcile_test",
  });

  await service.reconcileStartup();
  await service.reconcileConversation("conv_test", "request_test");
  assert.deepEqual(scopes, [
    undefined,
    undefined,
    undefined,
    "conv_test",
    "conv_test",
    "conv_test",
  ]);
});

function emptyWorkStore() {
  return {
    listExpiredLifecycleWork: async () => [],
    settleLifecycleWork: async () => undefined,
  };
}

function operationStore(operations: Map<string, TestOperation>) {
  const key = (conversationId: string, requestId: string) =>
    `${conversationId}:${requestId}`;
  return {
    readReconciliationOperation: async (
      conversationId: string,
      requestId: string,
    ) => operations.get(key(conversationId, requestId)),
    beginReconciliationOperation: async (operation: TestOperation) => {
      const operationKey = key(operation.conversationId, operation.requestId);
      const existing = operations.get(operationKey);
      if (existing) return existing;
      operations.set(operationKey, operation);
      return operation;
    },
    settleReconciliationOperation: async (operation: TestOperation) => {
      operations.set(
        key(operation.conversationId, operation.requestId),
        operation,
      );
      return operation;
    },
  };
}
