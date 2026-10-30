import type { ConversationSummary } from "@nervekit/contracts/core";
import type { CoreStorage } from "../storage/core-storage.js";

/** Publish the changed row and every ancestor whose derived activity may differ. */
export function publishSummary(
  storage: CoreStorage,
  emit: (change: {
    kind: "conversation_changed";
    summary: ConversationSummary;
  }) => void,
  id: string,
): void {
  const seen = new Set<string>();
  let current: string | null = id;
  while (current && !seen.has(current)) {
    seen.add(current);
    const summary = storage.conversations.getSummary(current);
    if (!summary) return;
    emit({ kind: "conversation_changed", summary });
    current = summary.parentConversationId;
  }
}
