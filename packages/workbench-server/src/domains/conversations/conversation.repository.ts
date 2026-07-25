import { rm } from "node:fs/promises";
import { join } from "node:path";
import {
  type ConversationRecord,
  conversationRecordSchema,
} from "@nervekit/contracts";
import {
  atomicWriteJson,
  type InitializedStorage,
  listChildDirs,
  readJsonFile,
} from "../../infrastructure/storage/index.js";

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
    const conversationIds = await listChildDirs(root);
    const parsed = await Promise.all(
      conversationIds.map(async (conversationId) =>
        conversationRecordSchema.safeParse(
          await readJsonFile<unknown>(
            this.conversationPath(conversationId),
          ).catch(() => undefined),
        ),
      ),
    );
    return parsed
      .filter((result) => result.success)
      .map((result) => result.data);
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
