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
      listToolCallPreviews: async () => [
        { interactions: [{ status: "pending" }, { status: "resolved" }] },
      ],
    },
    conversationQuery: {
      getConversationSnapshot: async () => ({ conversationRevision: 12 }),
    },
    operations: operationStore(operations),
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
    tools: { listToolCallPreviews: async () => [] },
    conversationQuery: {
      getConversationSnapshot: async () => ({ conversationRevision: 1 }),
    },
    operations: operationStore(new Map()),
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
