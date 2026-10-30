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
    const id = current;
    current = storage.conversations.parentId(id);
    try {
      const summary = storage.conversations.getSummary(id);
      if (summary) emit({ kind: "conversation_changed", summary });
    } catch (error) {
      storage.conversations.reportFailure(id, "publishSummary", error);
    }
  }
}
