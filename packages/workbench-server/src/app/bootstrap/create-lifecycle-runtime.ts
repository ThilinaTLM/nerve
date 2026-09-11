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
  logger: ApplicationLogger;
}) {
  const dispatcher = new LifecycleWorkDispatcher({
    store: input.store,
    bootId: `boot_${Date.now().toString(36)}`,
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
      setImmediate(() => void dispatcher.wake());
    },
    onWakeError: (error) => {
      void input.logger.warn("Lifecycle dispatcher wake failed", { error });
    },
  });
  return { dispatcher, lifecycle };
}
