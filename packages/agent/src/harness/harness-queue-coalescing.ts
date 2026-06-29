import type { ImageContent } from "@earendil-works/pi-ai";
import type { AgentMessage, QueueMode } from "../types.js";
import type { InboundQueuedMessage } from "./harness-queue-methods.js";
import { createUserMessage } from "./run/messages.js";

export type CoalescedQueuedMessage = {
  message: AgentMessage;
  entries: InboundQueuedMessage[];
};

type QueuedUserEntry = InboundQueuedMessage & {
  source: "user";
  message: Extract<AgentMessage, { role: "user" }>;
};

function isQueuedUserEntry(
  entry: InboundQueuedMessage | undefined,
): entry is QueuedUserEntry {
  return entry?.source === "user" && entry.message.role === "user";
}

function queuedUserMessageText(message: AgentMessage): string {
  if (message.role !== "user") return "";
  if (typeof message.content === "string") return message.content;
  return message.content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n");
}

function queuedUserMessageImages(message: AgentMessage): ImageContent[] {
  if (message.role !== "user" || typeof message.content === "string") {
    return [];
  }
  return message.content.filter(
    (part): part is ImageContent => part.type !== "text",
  );
}

export function takeQueuedMessageEntries(
  queue: InboundQueuedMessage[],
  mode: QueueMode,
): InboundQueuedMessage[] {
  if (mode === "all") return queue.splice(0);
  const first = queue[0];
  if (!first) return [];
  if (!isQueuedUserEntry(first)) return queue.splice(0, 1);
  let count = 1;
  while (count < queue.length && isQueuedUserEntry(queue[count])) {
    count += 1;
  }
  return queue.splice(0, count);
}

export function coalesceQueuedUserEntries(
  entries: InboundQueuedMessage[],
): CoalescedQueuedMessage[] {
  const groups: CoalescedQueuedMessage[] = [];
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    if (!entry) continue;
    if (!isQueuedUserEntry(entry)) {
      groups.push({ message: entry.message, entries: [entry] });
      continue;
    }
    const userEntries: InboundQueuedMessage[] = [entry];
    while (isQueuedUserEntry(entries[index + 1])) {
      index += 1;
      const nextEntry = entries[index];
      if (nextEntry) userEntries.push(nextEntry);
    }
    groups.push(coalesceQueuedUserEntryGroup(userEntries));
  }
  return groups;
}

function coalesceQueuedUserEntryGroup(
  entries: InboundQueuedMessage[],
): CoalescedQueuedMessage {
  if (entries.length === 1) {
    const entry = entries[0] as InboundQueuedMessage;
    return { message: entry.message, entries };
  }
  const first = entries[0] as InboundQueuedMessage;
  const text = entries
    .map((entry) => queuedUserMessageText(entry.message).trimEnd())
    .join("\n\n");
  const images = entries.flatMap((entry) =>
    queuedUserMessageImages(entry.message),
  );
  const message = createUserMessage(
    text,
    images.length > 0 ? images : undefined,
  );
  if (first.message.role === "user") {
    message.timestamp = first.message.timestamp;
  }
  return { message, entries };
}
