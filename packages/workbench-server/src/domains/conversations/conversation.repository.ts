import { dirname } from "node:path";
import type { ConversationRecord } from "@nervekit/contracts";
import type { ConversationJournalRepository } from "./conversation-journal.repository.js";

/** Journal-backed conversation metadata repository. */
export class ConversationRepository {
  constructor(readonly journal: ConversationJournalRepository) {}

  conversationDir(conversationId: string): string {
    return dirname(this.journal.journalPath(conversationId));
  }

  async loadAll(): Promise<ConversationRecord[]> {
    return (await this.journal.hydrateAll())
      .flatMap((state) => (state.conversation ? [state.conversation] : []))
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  async write(conversation: ConversationRecord): Promise<void> {
    await this.journal.commit(conversation.id, {
      kind: "conversation.upserted",
      events: [
        {
          kind: "conversation.upserted",
          conversationId: conversation.id,
          conversation,
        },
      ],
    });
  }

  async remove(conversationId: string): Promise<void> {
    await this.journal.remove(conversationId);
  }
}
