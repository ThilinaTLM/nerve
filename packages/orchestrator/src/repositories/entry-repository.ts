import { join } from "node:path";
import {
  type ConversationEntry,
  type ConversationRecord,
  type ConversationTree,
  conversationEntrySchema,
} from "@nerve/shared";
import {
  appendJsonLine,
  type InitializedStorage,
  readJsonLines,
} from "../storage.js";

export class EntryRepository {
  constructor(private readonly storage: InitializedStorage) {}

  entriesPath(conversationId: string): string {
    return join(
      this.storage.paths.home,
      "conversations",
      conversationId,
      "entries.jsonl",
    );
  }

  async loadForConversation(
    conversationId: string,
  ): Promise<ConversationEntry[]> {
    const rawEntries = await readJsonLines<unknown>(
      this.entriesPath(conversationId),
    ).catch(() => []);
    return rawEntries
      .map((entry) => conversationEntrySchema.safeParse(entry))
      .filter((result) => result.success)
      .map((result) => result.data);
  }

  async append(entry: ConversationEntry): Promise<void> {
    await appendJsonLine(this.entriesPath(entry.conversationId), entry, 0o600);
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
    if (!conversation.activeEntryId) return entries;
    const byId = new Map(entries.map((entry) => [entry.id, entry]));
    const branch: ConversationEntry[] = [];
    let cursor: string | undefined = conversation.activeEntryId;
    while (cursor) {
      const entry = byId.get(cursor);
      if (!entry) break;
      branch.push(entry);
      cursor = entry.parentEntryId;
    }
    return branch.reverse();
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
