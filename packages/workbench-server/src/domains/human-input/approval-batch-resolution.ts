import type {
  ConversationEntry,
  ConversationRecord,
} from "@nervekit/contracts/conversations";
import type { ToolCallRecord } from "@nervekit/contracts/tools";
import { ApplicationError } from "../../core/application-error.js";
import type { ApplicationLogger } from "../../infrastructure/diagnostics/logging.js";
import type { ConversationJournalRepository } from "../conversations/conversation-journal.repository.js";
import type { WorkbenchRunService } from "../runs/application/workbench-run.service.js";
import type { ToolService } from "../tools/execution/tool-service.js";
import { ApprovalSettlementRepository } from "./approval-settlement.repository.js";
import { ApprovalSettlementService } from "./approval-settlement.service.js";

interface ApprovalBatchResolutionDeps {
  tools: ToolService;
  runs: WorkbenchRunService;
  journal: ConversationJournalRepository;
  logger: ApplicationLogger;
  reconcileConversationProjection(
    conversation: ConversationRecord,
    entries: readonly ConversationEntry[],
  ): void;
}

/** Accepts decisions; execution belongs exclusively to the daemon settlement worker. */
export class ApprovalBatchResolutionService {
  private readonly repository: ApprovalSettlementRepository;
  private readonly worker: ApprovalSettlementService;
  private readonly locks = new Map<string, Promise<void>>();

  constructor(private readonly deps: ApprovalBatchResolutionDeps) {
    this.repository = new ApprovalSettlementRepository(deps.journal);
    this.worker = new ApprovalSettlementService({
      ...deps,
      repository: this.repository,
    });
  }

  start(): Promise<void> {
    return this.worker.start();
  }
  stop(): Promise<void> {
    return this.worker.stop();
  }

  async resolve(
    approvalId: string,
    decision: "allow" | "deny",
    note?: string,
    resolutionRequestId?: string,
    scope?:
      | "single_call"
      | "same_tool_same_args"
      | "run"
      | "always"
      | "always_conversation"
      | "always_project"
      | "always_user",
  ): Promise<ToolCallRecord> {
    const previous = this.locks.get(approvalId) ?? Promise.resolve();
    const result = previous
      .catch(() => undefined)
      .then(async () => {
        const approval = this.deps.tools
          .listApprovals()
          .find((item) => item.id === approvalId);
        if (!approval)
          throw new ApplicationError(
            404,
            "APPROVAL_NOT_FOUND",
            "Approval was not found.",
          );
        let tool = await this.deps.tools.getToolCallDetails(
          approval.toolCallId,
        );
        const ordinal = Number(
          approvalId.slice(approvalId.lastIndexOf("_") + 1),
        );
        const interaction = tool.interactions[ordinal];
        if (approval.status !== "pending") {
          if (
            !resolutionRequestId ||
            interaction?.resolutionRequestId !== resolutionRequestId ||
            interaction.resolution?.action !== decision ||
            interaction.resolution?.note !== note ||
            interaction.resolution?.scope !== scope
          ) {
            throw new ApplicationError(
              409,
              "APPROVAL_ALREADY_RESOLVED",
              "Approval already has a different decision.",
            );
          }
        } else {
          if (tool.runId)
            await this.deps.runs.assertPendingInteractionForToolCall(
              tool.id,
              tool.runId,
            );
          await this.deps.tools.decideApproval(
            approvalId,
            decision,
            note,
            resolutionRequestId,
            scope,
            (state, next) => this.repository.acceptanceEvents(state, next),
          );
          tool = await this.deps.tools.getToolCallDetails(tool.id);
        }
        const state = await this.deps.journal.load(tool.conversationId);
        for (const settlement of state.approvalSettlements.values()) {
          if (settlement.toolCallIds.includes(tool.id))
            this.worker.wake(settlement);
        }
        // The receipt denotes a durable decision, not successful external execution.
        return tool;
      });
    const tail = result.then(
      () => undefined,
      () => undefined,
    );
    this.locks.set(approvalId, tail);
    return result.finally(() => {
      if (this.locks.get(approvalId) === tail) this.locks.delete(approvalId);
    });
  }
}
