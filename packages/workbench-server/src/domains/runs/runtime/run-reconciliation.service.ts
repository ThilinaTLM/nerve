import {
  reconcileConversationResultSchema,
  type ReconcileConversationResult,
} from "@nervekit/contracts/conversations";

interface ReconciliationOperation {
  id: string;
  conversationId: string;
  requestId: string;
  status: "running" | "completed" | "failed";
  result?: unknown;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

export interface RunReconciliationDependencies {
  humanInput: {
    recoverReadyApprovalBatches(conversationId?: string): Promise<number>;
    recoverAcceptedPlanReviews(conversationId?: string): Promise<number>;
    recoverResolvedUserQuestions(conversationId?: string): Promise<number>;
  };
  tools: {
    listToolCallPreviews(query: {
      conversationId: string;
      status: "waiting";
      limit: number;
    }): Promise<
      Array<{
        interactions: Array<{ status: string }>;
      }>
    >;
  };
  conversationQuery: {
    getConversationSnapshot(
      conversationId: string,
    ): Promise<{ conversationRevision: number }>;
  };
  operations: {
    readReconciliationOperation(
      conversationId: string,
      requestId: string,
    ): Promise<ReconciliationOperation | undefined>;
    beginReconciliationOperation(
      operation: ReconciliationOperation,
    ): Promise<ReconciliationOperation>;
    settleReconciliationOperation(
      operation: ReconciliationOperation,
    ): Promise<ReconciliationOperation>;
  };
  operationId(conversationId: string, requestId: string): string;
  now?: () => Date;
}

/** Applies the same bounded, idempotent local reconciliation rules at startup and on explicit Refresh. */
export class RunReconciliationService {
  private readonly active = new Map<
    string,
    Promise<ReconcileConversationResult>
  >();

  constructor(private readonly deps: RunReconciliationDependencies) {}

  async reconcileConversation(
    conversationId: string,
    requestId: string,
  ): Promise<ReconcileConversationResult> {
    const key = `${conversationId}:${requestId}`;
    const active = this.active.get(key);
    if (active) return active;
    const operation = this.reconcileDurably(conversationId, requestId).finally(
      () => this.active.delete(key),
    );
    this.active.set(key, operation);
    return operation;
  }

  async reconcileStartup(): Promise<void> {
    await this.reconcileScope();
  }

  private async reconcileDurably(
    conversationId: string,
    requestId: string,
  ): Promise<ReconcileConversationResult> {
    const existing = await this.deps.operations.readReconciliationOperation(
      conversationId,
      requestId,
    );
    if (existing?.status === "completed" && existing.result) {
      return reconcileConversationResultSchema.parse(existing.result);
    }
    const now = (this.deps.now ?? (() => new Date()))().toISOString();
    const operationId = this.deps.operationId(conversationId, requestId);
    const started = await this.deps.operations.beginReconciliationOperation({
      id: operationId,
      conversationId,
      requestId,
      status: "running",
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    });
    if (started.status === "completed" && started.result) {
      return reconcileConversationResultSchema.parse(started.result);
    }
    try {
      const result = await this.reconcileScope(conversationId, operationId);
      if (!result)
        throw new Error("Conversation reconciliation returned no result.");
      await this.deps.operations.settleReconciliationOperation({
        ...started,
        status: "completed",
        result,
        error: undefined,
        updatedAt: (this.deps.now ?? (() => new Date()))().toISOString(),
      });
      return result;
    } catch (error) {
      await this.deps.operations.settleReconciliationOperation({
        ...started,
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
        updatedAt: (this.deps.now ?? (() => new Date()))().toISOString(),
      });
      throw error;
    }
  }

  private async reconcileScope(
    conversationId?: string,
    operationId?: string,
  ): Promise<ReconcileConversationResult | undefined> {
    const repairedApprovals =
      await this.deps.humanInput.recoverReadyApprovalBatches(conversationId);
    const repairedQuestions =
      await this.deps.humanInput.recoverResolvedUserQuestions(conversationId);
    const repairedPlans =
      await this.deps.humanInput.recoverAcceptedPlanReviews(conversationId);
    if (!conversationId || !operationId) return;
    const pending = await this.deps.tools.listToolCallPreviews({
      conversationId,
      status: "waiting",
      limit: 1_000,
    });
    const snapshot =
      await this.deps.conversationQuery.getConversationSnapshot(conversationId);
    return reconcileConversationResultSchema.parse({
      operationId,
      status: "completed",
      changed: repairedApprovals + repairedQuestions + repairedPlans > 0,
      observedRevision: snapshot.conversationRevision,
      preservedInputs: pending.reduce(
        (count, toolCall) =>
          count +
          toolCall.interactions.filter(
            (interaction) => interaction.status === "pending",
          ).length,
        0,
      ),
      repairedTransitions:
        repairedApprovals + repairedQuestions + repairedPlans,
      requeuedWork: 0,
      unknownOutcomes: 0,
      recoveryIssues: [],
    });
  }
}
