import { rm } from "node:fs/promises";
import { join } from "node:path";
import {
  type ConversationRecord,
  conversationRecordSchema,
} from "@nerve/shared";
import {
  atomicWriteJson,
  type InitializedStorage,
  listChildDirs,
  readJsonFile,
} from "../storage.js";

export class ConversationRepository {
  constructor(private readonly storage: InitializedStorage) {}

  conversationDir(conversationId: string): string {
    return join(this.storage.paths.home, "conversations", conversationId);
  }

  conversationPath(conversationId: string): string {
    return join(this.conversationDir(conversationId), "conversation.json");
  }

  harnessPath(conversationId: string): string {
    return join(this.conversationDir(conversationId), "harness.jsonl");
  }

  async loadAll(): Promise<ConversationRecord[]> {
    const root = join(this.storage.paths.home, "conversations");
    const conversations: ConversationRecord[] = [];
    for (const conversationId of await listChildDirs(root)) {
      const parsed = conversationRecordSchema.safeParse(
        await readJsonFile<unknown>(
          this.conversationPath(conversationId),
        ).catch(() => undefined),
      );
      if (parsed.success) conversations.push(parsed.data);
    }
    return conversations;
  }

  async write(conversation: ConversationRecord): Promise<void> {
    await atomicWriteJson(
      this.conversationPath(conversation.id),
      conversation,
      0o600,
    );
  }

  async remove(conversationId: string): Promise<void> {
    await rm(this.conversationDir(conversationId), {
      recursive: true,
      force: true,
    });
  }
}
