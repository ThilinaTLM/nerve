import type {
  CanonicalConversationEntry,
  ConversationEntry,
  ConversationTreeNode,
} from "@nervekit/contracts/conversations";

export function projectCanonicalTimelineEntry(
  entry: CanonicalConversationEntry,
): ConversationEntry {
  const inline = record(entry.inlineContent);
  const exact = record(inline.exactHarnessMessage);
  const role =
    entry.kind === "user_message"
      ? "user"
      : entry.kind === "assistant_message"
        ? "assistant"
        : "system";
  const text =
    string(inline.text) ??
    string(inline.summary) ??
    messageText(exact.content) ??
    "";
  return {
    id: entry.entryId,
    conversationId: entry.conversationId,
    ...(string(entry.provenance.agentId)
      ? { agentId: string(entry.provenance.agentId) }
      : {}),
    ...(entry.runId ? { runId: entry.runId } : {}),
    ...(entry.parentEntryId ? { parentEntryId: entry.parentEntryId } : {}),
    role,
    kind: entry.kind === "summary" ? "compaction" : "message",
    text,
    ...(entry.kind === "summary" ? { summary: text } : {}),
    details: {
      canonicalKind: entry.kind,
      provenance: entry.provenance,
      ...(entry.toolCallId ? { toolRecordId: entry.toolCallId } : {}),
    },
    createdAt:
      string(entry.provenance.createdAt) ??
      string(entry.provenance.legacyCreatedAt) ??
      new Date(0).toISOString(),
  };
}

export function projectCanonicalTree(
  entries: readonly CanonicalConversationEntry[],
): ConversationTreeNode[] {
  return entries.map((entry) => ({
    entry: projectCanonicalTimelineEntry(entry),
    childEntryIds: entries
      .filter((candidate) => candidate.parentEntryId === entry.entryId)
      .map((candidate) => candidate.entryId),
  }));
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function string(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function messageText(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return undefined;
  return value
    .flatMap((block) => {
      const item = record(block);
      return item.type === "text" && typeof item.text === "string"
        ? [item.text]
        : [];
    })
    .join("\n");
}
