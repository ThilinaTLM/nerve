import {
  conversationRecordSchema,
  type ConversationRecord,
} from "@nervekit/contracts/conversations";
import type { InitializedStorage } from "../../../infrastructure/storage-bootstrap/index.js";

const NAMESPACE = "canonical_conversation_metadata";
const SCOPE = "global";

/** Stores non-ancestry conversation metadata beside the canonical timeline. */
export class CanonicalConversationMetadataRepository {
  constructor(private readonly storage: InitializedStorage) {}

  async loadAll(): Promise<ConversationRecord[]> {
    return (
      await this.storage.canonicalStore.listDocuments<unknown>(NAMESPACE, SCOPE)
    )
      .map((document) => conversationRecordSchema.parse(document.data))
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  async read(conversationId: string): Promise<ConversationRecord | undefined> {
    const document = await this.storage.canonicalStore.readDocument(
      NAMESPACE,
      SCOPE,
      conversationId,
    );
    return document ? conversationRecordSchema.parse(document.data) : undefined;
  }

  async write(conversation: ConversationRecord): Promise<void> {
    const parsed = conversationRecordSchema.parse(conversation);
    const current = await this.storage.canonicalStore.readDocument(
      NAMESPACE,
      SCOPE,
      parsed.id,
    );
    await this.storage.canonicalStore.writeDocument({
      namespace: NAMESPACE,
      scopeId: SCOPE,
      documentId: parsed.id,
      data: parsed,
      expectedRevision: current?.revision ?? 0,
      now: parsed.updatedAt,
    });
  }

  async remove(conversationId: string): Promise<void> {
    await this.storage.canonicalStore.deleteDocument(
      NAMESPACE,
      SCOPE,
      conversationId,
    );
  }
}
