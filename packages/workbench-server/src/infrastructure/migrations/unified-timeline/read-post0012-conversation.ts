import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  conversationEntrySchema,
  conversationRecordSchema,
} from "@nervekit/contracts/conversations";
import type { LegacyConversationImportSource } from "./import-legacy-conversation.js";

/** Strict source-only reader for the released post-0012 conversation files. */
export async function readPost0012ConversationTimeline(input: {
  sourceHome: string;
  conversationId: string;
  importedAt: string;
}): Promise<LegacyConversationImportSource> {
  const directory = join(
    input.sourceHome,
    "conversations",
    input.conversationId,
  );
  const conversationBytes = await readFile(
    join(directory, "conversation.json"),
  );
  const entriesBytes = await readFile(join(directory, "entries.jsonl")).catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return Buffer.from("");
      throw error;
    },
  );
  const conversation = conversationRecordSchema.parse(
    JSON.parse(conversationBytes.toString("utf8")),
  );
  if (conversation.id !== input.conversationId) {
    throw new Error(
      "Legacy conversation directory and record identity differ.",
    );
  }
  const entries = entriesBytes
    .toString("utf8")
    .split(/\r?\n/u)
    .filter((line) => line.trim().length > 0)
    .map((line, index) => {
      try {
        return conversationEntrySchema.parse(JSON.parse(line));
      } catch (error) {
        throw new Error(
          `Legacy conversation entry line ${index + 1} is invalid.`,
          { cause: error },
        );
      }
    });
  const digest = createHash("sha256")
    .update(conversationBytes)
    .update(Buffer.from([0]))
    .update(entriesBytes)
    .digest("hex");
  return {
    conversationId: input.conversationId,
    entries,
    activeEntryId: conversation.activeEntryId ?? null,
    sourceLocator: `conversations/${input.conversationId}`,
    sourceDigest: `sha256:${digest}`,
    importedAt: input.importedAt,
  };
}
