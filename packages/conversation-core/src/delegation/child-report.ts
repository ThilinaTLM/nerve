import type { ConversationCore, ExecutionFinished } from "../core.js";

export function finalAssistantText(
  core: ConversationCore,
  result: ExecutionFinished,
): string {
  for (const event of core.getHistory(result.conversationId, {
    limit: Number.MAX_SAFE_INTEGER,
  })) {
    if (event.id === result.executionId) break;
    if (event.sequence > result.event.sequence) continue;
    if (event.type === "assistant_message") {
      const report = event.payload.content
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("\n");
      if (report) return report;
    }
  }
  return "";
}
