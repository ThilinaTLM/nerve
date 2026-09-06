import type { ConversationRecord } from "@nervekit/contracts/conversations";
import type { CanonicalStore } from "../../infrastructure/persistence/canonical-sqlite/canonical-store.js";
import type { ConversationDeletionProgress } from "../../infrastructure/persistence/canonical-sqlite/conversation-deletion.js";
import type { ConversationDeletionIntent } from "./conversation-deletion-progress.js";

export interface JournalDeletionOptions {
  operationId?: string;
  onProgress?: (progress: ConversationDeletionProgress) => void | Promise<void>;
  finish?: (intent: ConversationDeletionIntent) => Promise<void>;
}

/** Durable committed-to-delete identities, separate from bulk job recovery. */
export class ConversationJournalDeletion {
  readonly ready: Promise<void>;
  private readonly deleting = new Set<string>();

  constructor(
    private readonly canonical: CanonicalStore,
    ready: Promise<void>,
    private readonly exclusive: (
      conversationId: string,
      work: () => Promise<void>,
    ) => Promise<void>,
    private readonly evict: (conversationId: string) => void,
  ) {
    this.ready = ready.then(async () => {
      for (const key of await canonical.listDocumentKeys(
        "conversation_deletion",
        "global",
      ))
        this.deleting.add(key.documentId);
    });
  }

  async assertAvailable(conversationId: string): Promise<void> {
    await this.ready;
    if (this.deleting.has(conversationId))
      throw new Error(
        `Conversation ${conversationId} is being deleted; recovery must finish before it can be loaded or written.`,
      );
  }

  async remove(
    conversationId: string,
    options: JournalDeletionOptions = {},
  ): Promise<void> {
    await this.ready;
    this.deleting.add(conversationId);
    await this.exclusive(conversationId, async () => {
      const existing =
        await this.canonical.readDocument<ConversationDeletionIntent>(
          "conversation_deletion",
          "global",
          conversationId,
        );
      const conversation =
        await this.canonical.readDocument<ConversationRecord>(
          "conversation",
          "global",
          conversationId,
        );
      const intent: ConversationDeletionIntent = existing?.data ?? {
        conversationId,
        ...(conversation?.data.projectId
          ? { projectId: conversation.data.projectId }
          : {}),
        ...(options.operationId ? { operationId: options.operationId } : {}),
      };
      if (!existing)
        await this.canonical.writeDocument({
          namespace: "conversation_deletion",
          scopeId: "global",
          documentId: conversationId,
          expectedRevision: 0,
          data: intent,
        });
      this.evict(conversationId);
      await this.canonical.deleteConversationState(
        conversationId,
        options.onProgress,
      );
      await options.finish?.(intent);
      await this.canonical.deleteDocument(
        "conversation_deletion",
        "global",
        conversationId,
      );
      this.deleting.delete(conversationId);
    });
  }

  async recover(
    finish: (intent: ConversationDeletionIntent) => Promise<void>,
    onProgress?: (
      conversationId: string,
      progress: ConversationDeletionProgress,
    ) => void | Promise<void>,
  ): Promise<void> {
    await this.ready;
    for (const conversationId of [...this.deleting]) {
      await this.remove(conversationId, {
        finish,
        onProgress: (progress) => onProgress?.(conversationId, progress),
      });
    }
  }
}
