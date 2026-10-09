import { createHash } from "node:crypto";
import type { CoreStorage } from "@nervekit/conversation-core";
import type { Legacy, LegacyReader } from "./legacy.reader.js";

export interface SelectedPathVerification {
  roots: number;
  children: number;
  userMessageMismatches: string[];
  headMismatches: string[];
  unansweredToolCalls: number;
  duplicateToolResults: number;
  orphanToolResults: number;
}

export function userMessageDigest(message: Legacy): string {
  const content = message.content;
  const text =
    typeof content === "string"
      ? content
      : Array.isArray(content)
        ? content
            .filter((block: Legacy) => block.type === "text")
            .map((block: Legacy) => block.text)
            .join("\n")
        : "";
  return digest(text);
}

function digest(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

// Walk one row at a time and retain only digests/call IDs, never message bodies.
export function verifySelectedPath(input: {
  reader: LegacyReader;
  storage: CoreStorage;
  conversationId: string;
  oldLeafId: string | null;
  mappedLeafId: string | null;
  isRoot: boolean;
  label: string;
  summary: SelectedPathVerification;
}): void {
  const { reader, storage, summary } = input;
  const oldUsers: string[] = [];
  let oldId = input.oldLeafId;
  while (oldId) {
    const record = reader.record(oldId);
    if (!record) throw new Error(`Missing source leaf/predecessor ${oldId}`);
    const context = record.modelContext?.entry;
    if (context?.message?.role === "user")
      oldUsers.push(userMessageDigest(context.message));
    // History-only operational leaves have no Pi entry; their transcript
    // predecessor leads back into the model tree. Explicit Pi null stays null.
    oldId =
      context && "parentId" in context
        ? context.parentId
        : (record.entry?.parentEntryId ?? null);
  }
  const conversation = storage.conversations.get(input.conversationId)!;
  if (conversation.headEventId !== input.mappedLeafId)
    summary.headMismatches.push(input.label);
  const newUsers: string[] = [];
  const calls = new Map<string, number>();
  const results = new Map<string, number>();
  let eventId = conversation.headEventId;
  while (eventId) {
    const event = storage.events.get(eventId);
    if (!event) throw new Error(`Missing imported event ${eventId}`);
    if (event.type === "user_message")
      newUsers.push(digest(event.payload.text));
    if (event.type === "assistant_message") {
      for (const block of event.payload.content) {
        if (block.type === "toolCall")
          calls.set(block.id, (calls.get(block.id) ?? 0) + 1);
      }
    }
    if (
      event.type === "tool_call_response" &&
      event.payload.origin === "model"
    ) {
      const id = event.payload.providerCallId!;
      results.set(id, (results.get(id) ?? 0) + 1);
    }
    eventId = event.previousEventId;
  }
  if (input.isRoot) summary.roots++;
  else summary.children++;
  if (
    oldUsers.length !== newUsers.length ||
    oldUsers.some((value, index) => value !== newUsers[index])
  )
    summary.userMessageMismatches.push(input.label);
  for (const [id, count] of calls)
    summary.unansweredToolCalls += Math.max(0, count - (results.get(id) ?? 0));
  for (const [id, count] of results) {
    summary.duplicateToolResults += Math.max(0, count - 1);
    summary.orphanToolResults += Math.max(0, count - (calls.get(id) ?? 0));
  }
}
