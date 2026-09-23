import {
  reconcileConversationResultSchema,
  type ReconcileConversationResult,
} from "@nervekit/contracts/conversations";
import type { LifecycleWork, RecoveryIssue } from "@nervekit/contracts/runs";

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
    reconcileApprovalCheckpoints(conversationId?: string): Promise<number>;
    backfillLegacyApprovalCheckpoints(): Promise<number>;
    recoverAcceptedPlanReviews(conversationId?: string): Promise<number>;
    recoverResolvedUserQuestions(conversationId?: string): Promise<number>;
  };
  tools: {
    getToolCallDetails(toolCallId: string): Promise<{
      status: string;
      risk?: string;
      execution?: { hostHandle?: string };
    }>;
    settleUnknownOutcome(toolCallId: string, message: string): Promise<unknown>;
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
  runs: {
    getRunStatus(runId: string): Promise<string | undefined>;
  };
  conversationQuery: {
    getConversationSnapshot(
      conversationId: string,
    ): Promise<{ conversationRevision: number }>;
  };
  work: {
    listExpiredLifecycleWork(
      now: string,
      limit: number,
    ): Promise<LifecycleWork[]>;
    listRecoveryIssues(conversationId: string): Promise<RecoveryIssue[]>;
    persistRecoveryIssue(issue: RecoveryIssue): Promise<void>;
    requeueLifecycleWork(input: {
      workId: string;
      expectedGeneration: number;
      leaseOwner: string;
      now: string;
    }): Promise<LifecycleWork | undefined>;
    settleLifecycleWork(input: {
      workId: string;
      expectedGeneration: number;
      leaseOwner: string;
      state: "succeeded" | "failed" | "outcome_unknown";
      now: string;
      lastError?: string;
      failurePhase?: LifecycleWork["failurePhase"];
    }): Promise<LifecycleWork | undefined>;
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
  currentLeaseOwner?: string;
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
    await this.deps.humanInput.backfillLegacyApprovalCheckpoints();
    await this.reconcileScope(undefined, undefined, true);
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
    distrustExistingLeases = false,
  ): Promise<ReconcileConversationResult | undefined> {
    // Classify expired execution first, so checkpoints whose members are now
    // proven terminal settle in the same pass.
    const classified = await this.classifyExpiredToolWork(
      conversationId,
      distrustExistingLeases,
    );
    const repairedApprovals =
      await this.deps.humanInput.reconcileApprovalCheckpoints(conversationId);
    const repairedQuestions =
      await this.deps.humanInput.recoverResolvedUserQuestions(conversationId);
    const repairedPlans =
      await this.deps.humanInput.recoverAcceptedPlanReviews(conversationId);
    if (!conversationId || !operationId) return;
    const recoveryIssues =
      await this.deps.work.listRecoveryIssues(conversationId);
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
      requeuedWork: classified.requeuedWork,
      unknownOutcomes: recoveryIssues.length,
      recoveryIssues,
    });
  }

  private async classifyExpiredToolWork(
    conversationId?: string,
    distrustExistingLeases = false,
  ): Promise<{
    requeuedWork: number;
    unknownOutcomes: number;
    recoveryIssues: RecoveryIssue[];
  }> {
    const now = (this.deps.now ?? (() => new Date()))().toISOString();
    const expired = await this.deps.work.listExpiredLifecycleWork(
      distrustExistingLeases ? "9999-12-31T23:59:59.999Z" : now,
      100,
    );
    const recoveryIssues: RecoveryIssue[] = [];
    let requeuedWork = 0;
    for (const work of expired) {
      if (
        !["execute_tool", "continue_model"].includes(work.kind) ||
        !work.leaseOwner ||
        (distrustExistingLeases &&
          work.leaseOwner === this.deps.currentLeaseOwner) ||
        (conversationId && work.conversationId !== conversationId)
      ) {
        continue;
      }
      let proven = false;
      let safeReplay = false;
      let interruptedRead = false;
      if (work.kind === "execute_tool" && work.proposalId) {
        const toolCall = await this.deps.tools.getToolCallDetails(
          work.proposalId,
        );
        proven = ["completed", "failed", "denied", "cancelled"].includes(
          toolCall.status,
        );
        // `committed` proves the durable dispatch claim was never taken, so the
        // work can run again whatever the tool's risk. A `running` claim may
        // have dispatched; only read-only tools are then safe to repeat, and
        // repeating requires the claim, so they stay unknown as well.
        safeReplay = toolCall.status === "committed";
        interruptedRead =
          toolCall.status === "running" && toolCall.risk === "read";
      } else if (work.kind === "continue_model" && work.runId) {
        const runStatus = await this.deps.runs.getRunStatus(work.runId);
        proven = ["waiting", "completed", "failed", "cancelled"].includes(
          runStatus ?? "",
        );
      }
      if (interruptedRead && work.proposalId) {
        // A read-only tool has no external effect to protect, so report the
        // interruption to the model instead of blocking the checkpoint.
        await this.deps.tools.settleUnknownOutcome(
          work.proposalId,
          "Read-only tool execution was interrupted before its result was recorded.",
        );
        await this.deps.work.settleLifecycleWork({
          workId: work.id,
          expectedGeneration: work.generation,
          leaseOwner: work.leaseOwner,
          state: "failed",
          now,
          lastError: "Read-only tool execution was interrupted.",
          failurePhase: "post_dispatch",
        });
        continue;
      }
      if (!proven && safeReplay) {
        const requeued = await this.deps.work.requeueLifecycleWork({
          workId: work.id,
          expectedGeneration: work.generation,
          leaseOwner: work.leaseOwner,
          now,
        });
        if (requeued) requeuedWork += 1;
        continue;
      }
      await this.deps.work.settleLifecycleWork({
        workId: work.id,
        expectedGeneration: work.generation,
        leaseOwner: work.leaseOwner,
        state: proven ? "succeeded" : "outcome_unknown",
        now,
        ...(!proven
          ? {
              lastError: "Execution ownership expired without a proven result.",
              failurePhase: "post_dispatch" as const,
            }
          : {}),
      });
      if (!proven) {
        const issue: RecoveryIssue = {
          id: `recovery_${work.id.slice("work_".length)}`,
          conversationId: work.conversationId,
          ...(work.runId ? { runId: work.runId } : {}),
          workId: work.id,
          ...(work.kind === "execute_tool" && work.proposalId
            ? { proposalId: work.proposalId }
            : {}),
          code: "outcome_unknown",
          message:
            work.kind === "execute_tool"
              ? "Tool execution may have produced an external side effect, but no terminal result was proven."
              : "A provider request may have been sent, but no durable response was proven.",
          actions: ["inspect", "cancel_run", "authorize_retry"],
          createdAt: now,
        };
        await this.deps.work.persistRecoveryIssue(issue);
        recoveryIssues.push(issue);
      }
    }
    return {
      requeuedWork,
      unknownOutcomes: recoveryIssues.length,
      recoveryIssues,
    };
  }
}
