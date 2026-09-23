import { randomUUID } from "node:crypto";
import type { ApplicationLogger } from "../../infrastructure/diagnostics/index.js";
import type { CanonicalStore } from "../../infrastructure/persistence/canonical-sqlite/index.js";
import type { ConversationJournalRepository } from "../../domains/conversations/conversation-journal.repository.js";
import type { HumanInputResolutionService } from "../../domains/human-input/human-input-resolution.service.js";
import { RunLifecycleService } from "../../domains/runs/application/run-lifecycle.service.js";
import { LifecycleWorkDispatcher } from "../../domains/runs/runtime/lifecycle-work-dispatcher.js";

export function createRunLifecycleService(input: {
  store: CanonicalStore;
  journal: ConversationJournalRepository;
  notifyWork(): void;
}) {
  return new RunLifecycleService({
    journal: input.journal,
    receipts: input.store,
    notifyWork: input.notifyWork,
  });
}

export function createLifecycleWorkDispatcher(input: {
  store: CanonicalStore;
  humanInput: Pick<
    HumanInputResolutionService,
    | "executeApprovedToolWork"
    | "reconcileApprovalCheckpoints"
    | "recoverResolvedUserQuestions"
  >;
  continueModel(
    work: import("@nervekit/contracts/runs").LifecycleWork,
  ): Promise<void>;
  logger: ApplicationLogger;
  concurrency: { model: number; control: number };
}) {
  const bootId = `boot_${randomUUID()}`;
  const dispatcher = new LifecycleWorkDispatcher({
    store: input.store,
    bootId,
    concurrencyByLane: input.concurrency,
    onDrainError: (error) => {
      void input.logger.warn("Lifecycle dispatcher drain failed", { error });
    },
    onOutcomeUnknown: async (work, result) => {
      const createdAt = new Date().toISOString();
      await input.store.persistRecoveryIssue({
        id: `recovery_${work.id.slice("work_".length)}`,
        conversationId: work.conversationId,
        ...(work.runId ? { runId: work.runId } : {}),
        workId: work.id,
        ...(work.kind === "execute_tool" && work.proposalId
          ? { proposalId: work.proposalId }
          : {}),
        code: "outcome_unknown",
        message:
          result.lastError ??
          (work.kind === "continue_model"
            ? "A provider request may have been sent, but no durable response was proven."
            : "A tool may have produced an external side effect, but no durable result was proven."),
        actions:
          work.kind === "execute_tool"
            ? ["inspect"]
            : ["inspect", "cancel_run", "authorize_retry"],
        createdAt,
      });
    },
    handlers: {
      execute_tool: (work) => input.humanInput.executeApprovedToolWork(work),
      continue_model: async (work) => {
        if (!work.runId) {
          return { state: "failed", lastError: "Model work has no run." };
        }
        await input.continueModel(work);
        return { state: "succeeded" };
      },
      reconcile_conversation: async (work) => {
        // Proposal-only work without a run is a completed standalone decision.
        if (work.runId) {
          await input.humanInput.reconcileApprovalCheckpoints(
            work.conversationId,
          );
          await input.humanInput.recoverResolvedUserQuestions(
            work.conversationId,
          );
        }
        return { state: "succeeded" };
      },
    },
  });
  return { dispatcher, bootId };
}
