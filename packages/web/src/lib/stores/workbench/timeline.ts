import type { ToolCallRecord } from "../../api";
import type { TranscriptItem } from "./state.svelte";

export type TimelineItem =
  | { kind: "message"; key: string; item: TranscriptItem }
  | { kind: "tool"; key: string; toolCall: ToolCallRecord };

const TOOL_CALL_PLACEHOLDER = /^\[Tool call:[\s\S]*\]$/;

function isToolCallPlaceholder(item: TranscriptItem): boolean {
  return (
    item.role === "assistant" &&
    !item.thinkingBlocks?.length &&
    TOOL_CALL_PLACEHOLDER.test(item.text.trim())
  );
}

function byCreatedAtAscending(a: ToolCallRecord, b: ToolCallRecord): number {
  const cmp = a.createdAt.localeCompare(b.createdAt);
  return cmp !== 0 ? cmp : a.id.localeCompare(b.id);
}

function isLiveToolCall(toolCall: ToolCallRecord): boolean {
  return (
    toolCall.status === "requested" ||
    toolCall.status === "pending_approval" ||
    toolCall.status === "waiting_for_user" ||
    toolCall.status === "running"
  );
}

/**
 * Merge plain message entries with structured tool-call records into a single
 * branch-ordered timeline. The transcript/session branch is the source of truth:
 * completed tool cards are anchored at their corresponding tool-result entry,
 * while still-live/unanchored tool calls are appended after the current branch.
 */
export function buildConversationTimeline(
  transcript: TranscriptItem[],
  toolCalls: ToolCallRecord[],
): TimelineItem[] {
  const items: TimelineItem[] = [];
  const orderedToolCalls = [...toolCalls].sort(byCreatedAtAscending);
  const toolCallsById = new Map(
    orderedToolCalls.map((toolCall) => [toolCall.id, toolCall]),
  );
  const toolCallsBySourceId = new Map(
    orderedToolCalls.flatMap((toolCall) =>
      toolCall.sourceToolCallId ? [[toolCall.sourceToolCallId, toolCall]] : [],
    ),
  );
  const consumedToolCallIds = new Set<string>();

  transcript.forEach((item, index) => {
    if (isToolCallPlaceholder(item)) return;

    const toolCall = item.toolRecordId
      ? toolCallsById.get(item.toolRecordId)
      : item.toolCallId
        ? toolCallsBySourceId.get(item.toolCallId)
        : undefined;
    if (toolCall) {
      items.push({
        kind: "tool",
        key: toolCall.id,
        toolCall,
      });
      consumedToolCallIds.add(toolCall.id);
      return;
    }

    items.push({
      kind: "message",
      key: item.id ?? `msg-${index}`,
      item,
    });
  });

  for (const toolCall of orderedToolCalls) {
    if (consumedToolCallIds.has(toolCall.id) || !isLiveToolCall(toolCall)) {
      continue;
    }
    items.push({
      kind: "tool",
      key: toolCall.id,
      toolCall,
    });
  }

  return items;
}
