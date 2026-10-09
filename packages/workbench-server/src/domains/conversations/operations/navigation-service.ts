import type { RunRecord } from "@nervekit/contracts/runs";
import type { ConversationTreeEntry } from "@nervekit/harness/conversation";
import type {
  ConversationRecord,
  NavigateConversationRequest,
} from "@nervekit/contracts/conversations";
import { ApplicationError } from "../../../core/application-error.js";
import type { StreamLogRegistry } from "../../../infrastructure/events/index.js";
import {
  JournalBackedNavigation,
  type BranchSummary,
  type NavigationSnapshot,
} from "../journal-backed-navigation.js";
import {
  StaleNavigationError,
  validateModelHistoryPath,
  validateNavigationTarget,
} from "../model-history-navigation.js";
import { buildExtractiveSummary } from "./summary.js";

export interface NavigationServiceDeps {
  navigation: JournalBackedNavigation;
  withAdmission<T>(agentId: string, action: () => Promise<T>): Promise<T>;
  getActiveRunStatus(agentId: string): Promise<RunRecord["status"] | undefined>;
  rebuildConversation(conversationId: string, agentId: string): Promise<void>;
  events: StreamLogRegistry;
  reportDerivedFailure?(error: unknown): void;
}

export class NavigationService {
  constructor(private readonly deps: NavigationServiceDeps) {}

  async navigateConversation(
    conversationId: string,
    request: NavigateConversationRequest,
  ): Promise<ConversationRecord> {
    const initial = await this.deps.navigation.capture(conversationId);
    const targetEntryId = request.activeEntryId ?? null;
    const navigate = async () => {
      const snapshot = await this.deps.navigation.capture(conversationId);
      if (snapshot.agent?.id !== initial.agent?.id)
        throw new StaleNavigationError();
      validateNavigationTarget(snapshot.entriesById, targetEntryId);
      const changed =
        (snapshot.conversation.activeEntryId ?? null) !== targetEntryId ||
        snapshot.modelLeafId !== targetEntryId;
      if (changed && snapshot.agent) {
        const status = await this.deps.getActiveRunStatus(snapshot.agent.id);
        if (status && status !== "interrupted")
          throw new ApplicationError(
            409,
            "CONVERSATION_RUN_ACTIVE",
            "Stop or interrupt the active run before branching from conversation history.",
          );
      }
      const summary = request.summarize
        ? this.createBranchSummary(
            snapshot,
            targetEntryId,
            request.summaryInstructions,
          )
        : undefined;
      return this.deps.navigation.commit(snapshot, targetEntryId, summary);
    };
    const result = initial.agent
      ? await this.deps.withAdmission(initial.agent.id, navigate)
      : await navigate();
    if (!result.committed) return result.conversation;
    // Durable navigation already succeeded and its runtime projection was applied
    // inside admission. Derived work is outside both locks, never a rollback.
    await this.derived(() =>
      this.deps.rebuildConversation(conversationId, result.agentId!),
    );
    if (result.summaryEntry)
      await this.derived(() =>
        this.deps.events.publish("conversation.branch_summarized", {
          conversationId,
          fromEntryId: result.fromEntryId,
          targetEntryId: result.targetEntryId ?? undefined,
          entryId: result.summaryEntry!.id,
        }),
      );
    // Navigation is an action reference, not a current-metadata snapshot.
    // Its existing consumer refreshes authority. A delayed conversation.updated
    // payload could otherwise regress a newer metadata/branch commit.
    await this.derived(() =>
      this.deps.events.publish("conversation.navigated", {
        conversationId,
        activeEntryId: result.conversation.activeEntryId,
        targetEntryId: result.targetEntryId ?? undefined,
      }),
    );
    return result.conversation;
  }

  private async derived(action: () => Promise<unknown>): Promise<void> {
    try {
      await action();
    } catch (error) {
      try {
        if (this.deps.reportDerivedFailure)
          this.deps.reportDerivedFailure(error);
        else
          process.emitWarning(
            `Committed conversation navigation derived update failed: ${String(error)}`,
          );
      } catch {
        process.emitWarning(
          `Committed conversation navigation failure reporting failed: ${String(error)}`,
        );
      }
    }
  }

  private createBranchSummary(
    snapshot: NavigationSnapshot,
    targetEntryId: string | null,
    instructions?: string,
  ): BranchSummary | undefined {
    const oldBranch = validateModelHistoryPath(
      snapshot.entriesById,
      snapshot.modelLeafId,
    );
    if (snapshot.modelLeafId === targetEntryId) return undefined;
    const targetIds = new Set(
      validateNavigationTarget(snapshot.entriesById, targetEntryId).map(
        (entry) => entry.id,
      ),
    );
    const messages = oldBranch.filter(
      (entry): entry is Extract<ConversationTreeEntry, { type: "message" }> =>
        !targetIds.has(entry.id) && entry.type === "message",
    );
    if (!messages.length) return undefined;
    return {
      text: buildExtractiveSummary({
        title: "Branch summary",
        messages: messages.map((entry) => entry.message),
        instructions,
      }),
      summarizedEntryIds: messages.map((entry) => entry.id),
    };
  }
}
