import type { CanonicalStore } from "../../infrastructure/persistence/canonical-sqlite/index.js";
import { createId } from "@nervekit/contracts";
import {
  agentContextBindingSchema,
  agentRecordSchema,
  type AgentRecord,
} from "@nervekit/contracts/agents";
import type {
  ConversationEntry,
  ConversationJournalEvent,
  ConversationRecord,
} from "@nervekit/contracts/conversations";
import type { ConversationTreeEntry } from "@nervekit/harness/conversation";
import { ApplicationError } from "../../core/application-error.js";
import { resolveCompactionOwner } from "./compaction-owner.js";
import type { ConversationJournalRepository } from "./conversation-journal.repository.js";
import {
  validateModelHistoryPath,
  validateNavigationTarget,
} from "./model-history-navigation.js";

export interface NavigationSnapshot {
  conversation: ConversationRecord;
  revision: number;
  agent?: AgentRecord;
  ownerAgentId?: string;
  modelLeafId: string | null;
  entriesById: ReadonlyMap<string, ConversationTreeEntry>;
}
export interface BranchSummary {
  text: string;
  summarizedEntryIds: string[];
}
export interface NavigationOutcome {
  agentId: string | undefined;
  conversation: ConversationRecord;
  summaryEntry?: ConversationEntry;
  targetEntryId: string | null;
  fromEntryId: string | null;
  committed: boolean;
}

/** One journal commit owns selection, model leaf and both summary representations. */
export class JournalBackedNavigation {
  constructor(
    private readonly journal: ConversationJournalRepository,
    private readonly resolveControlAgent: (
      conversation: ConversationRecord,
    ) => Promise<AgentRecord | undefined>,
    private readonly applyCommitted: (
      conversation: ConversationRecord,
      entries: ConversationEntry[],
    ) => void,
  ) {}

  async capture(conversationId: string): Promise<NavigationSnapshot> {
    const state = await this.journal.load(conversationId);
    const conversation = state.conversation;
    if (!conversation)
      throw new ApplicationError(
        404,
        "CONVERSATION_NOT_FOUND",
        "Conversation not found.",
      );
    const agent = await this.resolveControlAgent(conversation);
    if (
      !agent &&
      (state.entries.length ||
        state.modelEntries.length ||
        state.modelLeafId !== null ||
        state.agentModelEntries.size ||
        state.agentModelLeafIds.size ||
        conversation.activeEntryId)
    )
      throw new ApplicationError(
        409,
        "INVALID_NAVIGATION_OWNER",
        "Conversation has no eligible control agent.",
      );
    const owner = resolveCompactionOwner(conversationId, agent);
    // Existing conversation controls must not silently become child branching.
    if (
      owner.ownerAgentId !== undefined ||
      (agent && agent.contextOwnerAgentId !== null)
    )
      throw new ApplicationError(
        409,
        "INVALID_NAVIGATION_OWNER",
        "Conversation navigation requires its persisted legacy control agent.",
      );
    return {
      conversation,
      revision: state.revision,
      agent,
      ownerAgentId: owner.ownerAgentId,
      modelLeafId: state.modelLeafId,
      entriesById: new Map(state.modelEntryById),
    };
  }

  async commit(
    snapshot: NavigationSnapshot,
    targetEntryId: string | null,
    summary?: BranchSummary,
  ): Promise<NavigationOutcome> {
    validateNavigationTarget(snapshot.entriesById, targetEntryId);
    if (summary)
      validateModelHistoryPath(snapshot.entriesById, snapshot.modelLeafId);
    const base = {
      agentId: snapshot.agent?.id,
      conversation: snapshot.conversation,
      targetEntryId,
      fromEntryId: snapshot.modelLeafId,
    };
    if (!snapshot.agent) {
      if (targetEntryId !== null || summary)
        throw new ApplicationError(
          409,
          "INVALID_NAVIGATION_OWNER",
          "Empty root has no navigation owner.",
        );
      return { ...base, committed: false };
    }
    const conversationId = snapshot.conversation.id;
    const timestamp = new Date().toISOString();
    const summaryEntry: ConversationEntry | undefined = summary
      ? {
          id: createId("entry"),
          conversationId,
          parentEntryId: targetEntryId ?? undefined,
          role: "system",
          kind: "branch_summary",
          text: summary.text,
          summary: summary.text,
          fromEntryId: snapshot.modelLeafId ?? undefined,
          createdAt: timestamp,
          details: {
            generatedBy: "orchestrator-extractive",
            summarizedEntryIds: summary.summarizedEntryIds,
            targetEntryId,
          },
        }
      : undefined;
    const finalLeaf = summaryEntry?.id ?? targetEntryId;
    const conversation = {
      ...snapshot.conversation,
      activeEntryId: finalLeaf ?? undefined,
      updatedAt: timestamp,
    };
    const events: ConversationJournalEvent[] = [];
    if (summaryEntry)
      events.push(
        {
          kind: "conversation.entry_appended",
          conversationId,
          entry: summaryEntry,
        },
        {
          kind: "model_context.entry_appended",
          conversationId,
          ownerAgentId: snapshot.ownerAgentId,
          entry: {
            type: "branch_summary",
            id: summaryEntry.id,
            parentId: targetEntryId,
            timestamp,
            fromId: snapshot.modelLeafId ?? "root",
            summary: summaryEntry.text,
            details: {
              generatedBy: "orchestrator-extractive",
              summarizedEntryIds: summary!.summarizedEntryIds,
              targetEntryId,
            },
          },
        },
      );
    events.push(
      { kind: "conversation.upserted", conversationId, conversation },
      {
        kind: "model_context.leaf_changed",
        conversationId,
        ownerAgentId: snapshot.ownerAgentId,
        entryId: finalLeaf,
      },
    );
    await this.journal.commit(
      conversationId,
      {
        kind: "conversation.navigated",
        events,
        navigationGuard: {
          agentId: snapshot.agent.id,
          ownerAgentId: snapshot.ownerAgentId,
          expectedActiveEntryId: snapshot.conversation.activeEntryId ?? null,
          expectedModelLeafId: snapshot.modelLeafId,
          targetEntryId,
          requireValidSource: Boolean(summary),
        },
      },
      snapshot.revision,
    );
    const committed = await this.journal.load(conversationId);
    // Other metadata writers do not hold agent admission. Apply one current
    // authoritative projection, synchronously, without overwriting a commit
    // that completed after this navigation. Keep the command's own proof below.
    this.applyCommitted(committed.conversation!, [...committed.entries]);
    return { ...base, conversation, summaryEntry, committed: true };
  }
}

/** Persisted legacy binding, not agent kind or transcript ancestry, owns controls. */
export async function resolveConversationNavigationAgent(
  canonical: CanonicalStore,
  conversation: ConversationRecord,
  getRegisteredAgent: (agentId: string) => AgentRecord | undefined,
): Promise<AgentRecord | undefined> {
  const bindingDocument = await canonical.readDocument<unknown>(
    "agent-context-binding",
    "global",
    conversation.id,
  );
  const invalid = () =>
    new ApplicationError(
      409,
      "INVALID_NAVIGATION_OWNER",
      "Conversation navigation owner is missing, inconsistent or not selected.",
    );
  // No binding can represent a new, unassigned conversation only. The adapter
  // additionally verifies its canonical transcript/model trees and cursors are empty.
  if (!bindingDocument) {
    if (conversation.activeAgentId) throw invalid();
    return undefined;
  }
  const binding = agentContextBindingSchema.safeParse(bindingDocument.data);
  if (!binding.success) throw invalid();
  const document = await canonical.readDocument<unknown>(
    "agent",
    "global",
    binding.data.legacyRootAgentId,
  );
  const parsed = agentRecordSchema.safeParse(document?.data);
  if (
    !parsed.success ||
    parsed.data.id !== binding.data.legacyRootAgentId ||
    parsed.data.conversationId !== conversation.id ||
    parsed.data.projectId !== conversation.projectId ||
    parsed.data.contextOwnerAgentId !== null ||
    parsed.data.parentAgentId !== undefined ||
    (conversation.activeAgentId &&
      conversation.activeAgentId !== parsed.data.id)
  )
    throw invalid();
  // The registry proves the exact bound actor is available, not who owns history.
  // Unbound duplicate claims cannot replace or invalidate the unique binding.
  const registered = getRegisteredAgent(binding.data.legacyRootAgentId);
  if (
    !registered ||
    registered.id !== parsed.data.id ||
    registered.conversationId !== parsed.data.conversationId ||
    registered.projectId !== parsed.data.projectId ||
    registered.rootAgentId !== parsed.data.rootAgentId ||
    registered.contextOwnerAgentId !== null ||
    registered.parentAgentId !== undefined
  )
    throw invalid();
  return parsed.data;
}
