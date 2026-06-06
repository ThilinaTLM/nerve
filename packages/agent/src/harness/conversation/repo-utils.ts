import { ConversationError, type FileError } from "../errors.js";
import type { Result } from "../result.js";
import { Conversation } from "./conversation.js";
import type {
  ConversationMetadata,
  ConversationStorage,
  ConversationTreeEntry,
} from "./entries.js";
import { uuidv7 } from "./uuid.js";

export function createConversationId(): string {
  return uuidv7();
}

export function createTimestamp(): string {
  return new Date().toISOString();
}

export function toConversation<TMetadata extends ConversationMetadata>(
  storage: ConversationStorage<TMetadata>,
): Conversation<TMetadata> {
  return new Conversation(storage);
}

export function getFileSystemResultOrThrow<TValue>(
  result: Result<TValue, FileError>,
  message: string,
): TValue {
  if (!result.ok) {
    const code = result.error.code === "not_found" ? "not_found" : "storage";
    throw new ConversationError(
      code,
      `${message}: ${result.error.message}`,
      result.error,
    );
  }
  return result.value;
}

export async function getEntriesToFork(
  storage: ConversationStorage,
  options: { entryId?: string; position?: "before" | "at" },
): Promise<ConversationTreeEntry[]> {
  if (!options.entryId) return storage.getEntries();
  const target = await storage.getEntry(options.entryId);
  if (!target) {
    throw new ConversationError(
      "invalid_fork_target",
      `Entry ${options.entryId} not found`,
    );
  }
  let effectiveLeafId: string | null;
  if ((options.position ?? "before") === "at") {
    effectiveLeafId = target.id;
  } else {
    if (target.type !== "message" || target.message.role !== "user") {
      throw new ConversationError(
        "invalid_fork_target",
        `Entry ${options.entryId} is not a user message`,
      );
    }
    effectiveLeafId = target.parentId;
  }
  return storage.getPathToRoot(effectiveLeafId);
}
