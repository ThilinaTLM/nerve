import type { ConversationTreeEntry } from "@nervekit/harness";
import type {
  ConversationEntry,
  ConversationRecord,
  ConversationTree,
} from "@nervekit/contracts/conversations";
import type { ConversationJournalRepository } from "./conversation-journal.repository.js";

export class EntryRepository {
  constructor(private readonly journal: ConversationJournalRepository) {}

  async loadForConversation(
    conversationId: string,
  ): Promise<ConversationEntry[]> {
    return [...(await this.journal.load(conversationId)).entries];
  }

  async append(entry: ConversationEntry): Promise<ConversationEntry> {
    await this.journal.commit(entry.conversationId, {
      kind: "conversation.entry_appended",
      idempotencyKey: `conversation-entry:${entry.id}`,
      events: [
        {
          kind: "conversation.entry_appended",
          conversationId: entry.conversationId,
          entry,
        },
      ],
    });
    return (
      (await this.journal.load(entry.conversationId)).entryById.get(entry.id) ??
      entry
    );
  }

  async appendCompaction(input: {
    entry: ConversationEntry;
    modelEntry: ConversationTreeEntry;
    conversation: ConversationRecord;
  }): Promise<void> {
    await this.journal.commit(input.entry.conversationId, {
      kind: "compaction.completed",
      idempotencyKey: `compaction:${input.entry.id}`,
      events: [
        {
          kind: "conversation.entry_appended",
          conversationId: input.entry.conversationId,
          entry: input.entry,
        },
        {
          kind: "conversation.upserted",
          conversationId: input.entry.conversationId,
          conversation: input.conversation,
        },
        {
          kind: "model_context.entry_appended",
          conversationId: input.entry.conversationId,
          entry: input.modelEntry as never,
        },
        {
          kind: "model_context.leaf_changed",
          conversationId: input.entry.conversationId,
          entryId: input.modelEntry.id,
        },
      ],
    });
  }

  displayLinkedEntries(entries: ConversationEntry[]): ConversationEntry[] {
    const allIds = new Set(entries.map((entry) => entry.id));
    let previousVisibleEntryId: string | undefined;
    return entries.map((entry) => {
      const parentEntryId = entry.parentEntryId;
      const normalized =
        parentEntryId && !allIds.has(parentEntryId)
          ? { ...entry, parentEntryId: previousVisibleEntryId }
          : entry;
      previousVisibleEntryId = normalized.id;
      return normalized;
    });
  }

  activeBranchEntries(
    entriesByConversationId: Map<string, ConversationEntry[]>,
    conversation: ConversationRecord,
  ): ConversationEntry[] {
    const entries = this.displayLinkedEntries(
      entriesByConversationId.get(conversation.id) ?? [],
    );
    return activeBranchFromEntries(entries, conversation.activeEntryId);
  }

  activeBranchEntryIds(
    entriesByConversationId: Map<string, ConversationEntry[]>,
    conversation: ConversationRecord,
  ): string[] {
    return this.activeBranchEntries(entriesByConversationId, conversation).map(
      (entry) => entry.id,
    );
  }

  getConversationTree(
    entriesByConversationId: Map<string, ConversationEntry[]>,
    conversation: ConversationRecord,
  ): ConversationTree {
    const entries = this.displayLinkedEntries(
      entriesByConversationId.get(conversation.id) ?? [],
    );
    const children = new Map<string, string[]>();
    const rootEntryIds: string[] = [];
    for (const entry of entries) {
      if (entry.parentEntryId) {
        const childEntryIds = children.get(entry.parentEntryId) ?? [];
        childEntryIds.push(entry.id);
        children.set(entry.parentEntryId, childEntryIds);
      } else {
        rootEntryIds.push(entry.id);
      }
    }
    return {
      conversationId: conversation.id,
      activeEntryId: conversation.activeEntryId,
      rootEntryIds,
      nodes: entries.map((entry) => ({
        entry,
        childEntryIds: children.get(entry.id) ?? [],
      })),
    };
  }
}

export function activeBranchFromEntries(
  entries: ConversationEntry[],
  activeEntryId: string | undefined,
): ConversationEntry[] {
  if (!activeEntryId) return [];
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const branch: ConversationEntry[] = [];
  let cursor: string | undefined = activeEntryId;
  while (cursor) {
    const entry = byId.get(cursor);
    if (!entry) break;
    branch.push(entry);
    cursor = entry.parentEntryId;
  }
  return branch.reverse();
}
