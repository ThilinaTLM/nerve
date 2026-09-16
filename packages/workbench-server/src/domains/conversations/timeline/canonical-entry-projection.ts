import type {
  CanonicalConversationEntry,
  ConversationEntry,
} from "@nervekit/contracts/conversations";

export function projectCanonicalEntry(
  entry: CanonicalConversationEntry,
): ConversationEntry {
  const content = entry.inlineContent as Record<string, unknown>;
  const role: ConversationEntry["role"] =
    content.role === "user" ||
    content.role === "assistant" ||
    content.role === "system"
      ? content.role
      : entry.kind === "user_message"
        ? "user"
        : entry.kind === "tool_result" || entry.kind === "child_result"
          ? "system"
          : "assistant";
  return {
    id: entry.entryId,
    conversationId: entry.conversationId,
    agentId:
      typeof entry.provenance.agentId === "string"
        ? entry.provenance.agentId
        : undefined,
    runId: entry.runId,
    turnId: undefined,
    liveMessageId: undefined,
    messageOrdinal: undefined,
    parentEntryId: entry.parentEntryId ?? undefined,
    role,
    kind: entry.kind === "summary" ? "compaction" : "message",
    text: typeof content.text === "string" ? content.text : "",
    summary: typeof content.summary === "string" ? content.summary : undefined,
    tokensBefore: undefined,
    usage:
      content.usage && typeof content.usage === "object"
        ? (content.usage as ConversationEntry["usage"])
        : undefined,
    firstKeptEntryId: undefined,
    fromEntryId: undefined,
    details: entry.toolCallId
      ? {
          ...(content.details && typeof content.details === "object"
            ? content.details
            : {}),
          toolRecordId: entry.toolCallId,
        }
      : content.details,
    createdAt:
      typeof entry.provenance.createdAt === "string"
        ? entry.provenance.createdAt
        : new Date(0).toISOString(),
  };
}
