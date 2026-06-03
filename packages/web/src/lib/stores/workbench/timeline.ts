import type { ToolCallRecord } from "../../api";
import type { TranscriptItem } from "./state.svelte";

export type TimelineItem =
  | { kind: "message"; key: string; sortKey: string; item: TranscriptItem }
  | { kind: "tool"; key: string; sortKey: string; toolCall: ToolCallRecord };

const TOOL_CALL_PLACEHOLDER = /^\[Tool call:[\s\S]*\]$/;

function isToolCallPlaceholder(item: TranscriptItem): boolean {
  return (
    item.role === "assistant" && TOOL_CALL_PLACEHOLDER.test(item.text.trim())
  );
}

/**
 * Merge plain message entries with structured tool-call records into a single
 * time-ordered timeline. Tool-call placeholder assistant entries and tool-result
 * system entries are dropped because the structured tool card renders that data.
 */
export function buildConversationTimeline(
  transcript: TranscriptItem[],
  toolCalls: ToolCallRecord[],
): TimelineItem[] {
  const items: TimelineItem[] = [];

  transcript.forEach((item, index) => {
    if (item.toolCallId) return; // tool-result entry, rendered inside the tool card
    if (isToolCallPlaceholder(item)) return; // tool-only assistant entry
    items.push({
      kind: "message",
      key: item.id ?? `msg-${index}`,
      sortKey: item.createdAt ?? "",
      item,
    });
  });

  for (const toolCall of toolCalls) {
    items.push({
      kind: "tool",
      key: toolCall.id,
      sortKey: toolCall.createdAt,
      toolCall,
    });
  }

  return items
    .map((value, index) => ({ value, index }))
    .sort((a, b) => {
      if (a.value.sortKey && b.value.sortKey) {
        const cmp = a.value.sortKey.localeCompare(b.value.sortKey);
        if (cmp !== 0) return cmp;
      } else if (a.value.sortKey !== b.value.sortKey) {
        // Items without a timestamp (e.g. optimistic user message) sort last.
        return a.value.sortKey ? -1 : 1;
      }
      return a.index - b.index; // stable tie-break
    })
    .map(({ value }) => value);
}
