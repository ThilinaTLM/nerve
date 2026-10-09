import type {
  ConversationEvent,
  ConversationSnapshot,
} from "@nervekit/contracts/core";
import { summarizeConversationUsage } from "$lib/presentation/usage/conversation-usage";

export function conversationContext(
  snapshot: ConversationSnapshot,
  events: readonly ConversationEvent[],
) {
  const boundary = [...events]
    .reverse()
    .find(
      (event) =>
        event.type === "assistant_message" || event.type === "compaction",
    );
  const lastResponse =
    boundary?.type === "assistant_message" ? boundary.payload : undefined;
  const usage = summarizeConversationUsage(events);
  return {
    config: snapshot.config,
    conversation: snapshot.conversation,
    usage,
    requestTokens: lastResponse
      ? lastResponse.usage.input +
        lastResponse.usage.cacheRead +
        lastResponse.usage.cacheWrite
      : null,
    requestModel: lastResponse
      ? { provider: lastResponse.provider, modelId: lastResponse.model }
      : snapshot.config.model,
    compacted: boundary?.type === "compaction",
    queuedCount: snapshot.queue.length,
    openToolCount: snapshot.toolCalls.length,
    activeBashCount: snapshot.asyncBash.filter(
      (bash) => bash.status === "running",
    ).length,
  };
}
