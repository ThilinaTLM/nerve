import { randomUUID } from "node:crypto";
import type { ApplicationLogger } from "../../infrastructure/diagnostics/index.js";
import type { CanonicalStore } from "../../infrastructure/persistence/canonical-sqlite/index.js";
import type { ConversationJournalRepository } from "../../domains/conversations/conversation-journal.repository.js";
import type { HumanInputResolutionService } from "../../domains/human-input/human-input-resolution.service.js";
import type { ToolService } from "../../domains/tools/execution/tool-service.js";
import { RunLifecycleService } from "../../domains/runs/application/run-lifecycle.service.js";
import { LifecycleWorkDispatcher } from "../../domains/runs/runtime/lifecycle-work-dispatcher.js";

export function createLifecycleRuntime(input: {
  store: CanonicalStore;
  journal: ConversationJournalRepository;
  tools: ToolService;
  humanInput(): HumanInputResolutionService;
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
        code: "outcome_unknown",
        message:
          result.lastError ??
          (work.kind === "continue_model"
            ? "A provider request may have been sent, but no durable response was proven."
            : "A tool may have produced an external side effect, but no durable result was proven."),
        actions: ["inspect", "cancel_run", "authorize_retry"],
        createdAt,
      });
    },
    handlers: {
      execute_tool: async (work) => {
        if (!work.proposalId) {
          return { state: "failed", lastError: "Tool work has no proposal." };
        }
        const approval = await input.tools.getApprovalForToolCallDetails(
          work.proposalId,
        );
        if (!approval) {
          return { state: "failed", lastError: "Approval was not found." };
        }
        await input.tools.finalizeDecidedApproval(approval.id);
        await input
          .humanInput()
          .recoverReadyApprovalBatches(work.conversationId);
        return { state: "succeeded" };
      },
      continue_model: async (work) => {
        if (!work.runId) {
          return { state: "failed", lastError: "Model work has no run." };
        }
        await input.continueModel(work);
        return { state: "succeeded" };
      },
      reconcile_conversation: async (work) => {
        const humanInput = input.humanInput();
        if (work.runId) {
          await humanInput.recoverReadyApprovalBatches(work.conversationId);
          await humanInput.recoverResolvedUserQuestions(work.conversationId);
        } else if (work.proposalId) {
          const approval = await input.tools.getApprovalForToolCallDetails(
            work.proposalId,
          );
          if (approval) {
            await input.tools.finalizeDecidedApproval(approval.id);
          }
        }
        return { state: "succeeded" };
      },
    },
  });
  const lifecycle = new RunLifecycleService({
    journal: input.journal,
    receipts: input.store,
    wakeWork: () => {
      setImmediate(() => dispatcher.trigger());
    },
    onWakeError: (error) => {
      void input.logger.warn("Lifecycle dispatcher wake failed", { error });
    },
  });
  return { dispatcher, lifecycle, bootId };
}
