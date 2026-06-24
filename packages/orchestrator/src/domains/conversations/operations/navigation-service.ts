import type { ConversationTreeEntry } from "@nervekit/agent";
import type {
  ConversationEntry,
  ConversationRecord,
  NavigateConversationRequest,
  ProjectRecord,
} from "@nervekit/shared";
import { HttpError } from "../../../http/errors.js";
import type { EventBus } from "../../../infrastructure/events/index.js";
import type { HarnessManager } from "../harness-manager.js";
import type { AppendConversationEntry } from "./compaction-service.js";
import { buildExtractiveSummary } from "./summary.js";

export class NavigationService {
  constructor(
    private readonly getConversation: (
      conversationId: string,
    ) => ConversationRecord,
    private readonly getProject: (projectId: string) => ProjectRecord,
    private readonly entriesByConversationId: Map<string, ConversationEntry[]>,
    private readonly updateConversation: (
      conversation: ConversationRecord,
    ) => Promise<void>,
    private readonly appendEntry: AppendConversationEntry,
    private readonly harnessManager: HarnessManager,
    private readonly rebuildConversations: () => Promise<void>,
    private readonly events: EventBus,
  ) {}

  async navigateConversation(
    conversationId: string,
    request: NavigateConversationRequest,
  ): Promise<ConversationRecord> {
    const conversation = this.getConversation(conversationId);
    const activeEntryId = request.activeEntryId ?? undefined;
    if (
      activeEntryId &&
      !(this.entriesByConversationId.get(conversation.id) ?? []).some(
        (entry) => entry.id === activeEntryId,
      )
    ) {
      throw new HttpError(404, "ENTRY_NOT_FOUND", "Entry not found.");
    }

    let summaryEntry: ConversationEntry | undefined;
    if (request.summarize && conversation.activeEntryId !== activeEntryId) {
      summaryEntry = await this.createBranchSummaryEntry(
        conversation,
        activeEntryId,
        request.summaryInstructions,
      );
    }

    const nextActiveEntryId = summaryEntry?.id ?? activeEntryId;
    const updated = {
      ...this.getConversation(conversationId),
      activeEntryId: nextActiveEntryId,
      updatedAt: new Date().toISOString(),
    };
    await this.updateConversation(updated);
    await this.harnessManager.setLeaf(updated, nextActiveEntryId);
    await this.rebuildConversations();
    await this.events.publish("conversation.navigated", {
      conversationId: conversation.id,
      activeEntryId: nextActiveEntryId,
      targetEntryId: activeEntryId,
      summaryEntry,
    });
    return updated;
  }

  async createBranchSummaryEntry(
    conversation: ConversationRecord,
    targetEntryId: string | undefined,
    instructions?: string,
  ): Promise<ConversationEntry | undefined> {
    const project = this.getProject(conversation.projectId);
    const storage = await this.harnessManager.openStorage(
      conversation,
      project.dir,
    );
    const oldLeafId = await storage.getLeafId();
    if (oldLeafId === (targetEntryId ?? null)) return undefined;

    const oldBranch = oldLeafId ? await storage.getPathToRoot(oldLeafId) : [];
    const targetBranch = targetEntryId
      ? await storage.getPathToRoot(targetEntryId)
      : [];
    const targetIds = new Set(targetBranch.map((entry) => entry.id));
    const entriesToSummarize = oldBranch.filter(
      (entry): entry is Extract<ConversationTreeEntry, { type: "message" }> =>
        !targetIds.has(entry.id) && entry.type === "message",
    );
    if (entriesToSummarize.length === 0) return undefined;

    const summary = buildExtractiveSummary({
      title: "Branch summary",
      messages: entriesToSummarize.map((entry) => entry.message),
      instructions,
    });
    const entry = await this.appendEntry(
      {
        conversationId: conversation.id,
        parentEntryId: targetEntryId ?? null,
        role: "system",
        kind: "branch_summary",
        text: summary,
        summary,
        fromEntryId: oldLeafId ?? undefined,
        details: {
          generatedBy: "orchestrator-extractive",
          summarizedEntryIds: entriesToSummarize.map((item) => item.id),
          targetEntryId,
        },
      },
      { mirrorToHarness: false },
    );
    await storage.setLeafId(targetEntryId ?? null);
    await storage.appendEntry({
      type: "branch_summary",
      id: entry.id,
      parentId: targetEntryId ?? null,
      timestamp: entry.createdAt,
      fromId: oldLeafId ?? "root",
      summary,
      details: entry.details,
    });
    await this.events.publish("conversation.branch_summarized", {
      conversationId: conversation.id,
      fromEntryId: oldLeafId,
      targetEntryId,
      entry,
    });
    return entry;
  }
}
