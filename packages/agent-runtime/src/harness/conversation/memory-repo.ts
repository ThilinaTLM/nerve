import { ConversationError } from "../errors.js";
import type {
  Conversation,
  ConversationMetadata,
  ConversationRepo,
} from "./entries.js";
import { InMemoryConversationStorage } from "./memory-storage.js";
import {
  createConversationId,
  createTimestamp,
  getEntriesToFork,
  toConversation,
} from "./repo-utils.js";

export class InMemoryConversationRepo
  implements ConversationRepo<ConversationMetadata, { id?: string }, void>
{
  private conversations = new Map<string, Conversation<ConversationMetadata>>();

  async create(
    options: { id?: string } = {},
  ): Promise<Conversation<ConversationMetadata>> {
    const metadata: ConversationMetadata = {
      id: options.id ?? createConversationId(),
      createdAt: createTimestamp(),
    };
    const storage = new InMemoryConversationStorage({ metadata });
    const conversation = toConversation(storage);
    this.conversations.set(metadata.id, conversation);
    return conversation;
  }

  async open(
    metadata: ConversationMetadata,
  ): Promise<Conversation<ConversationMetadata>> {
    const conversation = this.conversations.get(metadata.id);
    if (!conversation) {
      throw new ConversationError(
        "not_found",
        `Conversation not found: ${metadata.id}`,
      );
    }
    return conversation;
  }

  async list(): Promise<ConversationMetadata[]> {
    return Promise.all(
      [...this.conversations.values()].map((conversation) =>
        conversation.getMetadata(),
      ),
    );
  }

  async delete(metadata: ConversationMetadata): Promise<void> {
    this.conversations.delete(metadata.id);
  }

  async fork(
    sourceMetadata: ConversationMetadata,
    options: { entryId?: string; position?: "before" | "at"; id?: string },
  ): Promise<Conversation<ConversationMetadata>> {
    const source = await this.open(sourceMetadata);
    const forkedEntries = await getEntriesToFork(source.getStorage(), options);
    const metadata: ConversationMetadata = {
      id: options.id ?? createConversationId(),
      createdAt: createTimestamp(),
    };
    const storage = new InMemoryConversationStorage({
      metadata,
      entries: forkedEntries,
    });
    const conversation = toConversation(storage);
    this.conversations.set(metadata.id, conversation);
    return conversation;
  }
}
