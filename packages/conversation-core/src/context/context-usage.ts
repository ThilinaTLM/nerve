import type { ConversationEvent } from "@nervekit/contracts/core";
import {
  estimateContextTokens,
  estimateRetainedContextTokens,
  type ContextUsageEstimate,
} from "@nervekit/harness/compaction";
import {
  buildModelMessages,
  selectContextEvents,
  type Message,
  type ProjectionOptions,
} from "./context-projection.js";

export function estimateMessageUsage(
  messages: Message[],
): ContextUsageEstimate {
  return estimateContextTokens(messages);
}

export function estimatePathUsage(
  path: ConversationEvent[],
  options: ProjectionOptions = {},
): ContextUsageEstimate {
  const messages = buildModelMessages(path, options);
  const { compaction } = selectContextEvents(path);
  const hasFreshUsage =
    compaction &&
    path
      .slice(path.indexOf(compaction) + 1)
      .some(
        (event) =>
          event.type === "assistant_message" &&
          event.payload.usage.totalTokens > 0 &&
          !["error", "aborted"].includes(event.payload.stopReason),
      );
  if (!compaction || hasFreshUsage) return estimateMessageUsage(messages);
  // Retained assistant usage describes the pre-compaction request, not this context.
  const tokens = estimateRetainedContextTokens(messages);
  return {
    tokens,
    usageTokens: 0,
    trailingTokens: tokens,
    lastUsageIndex: null,
  };
}
