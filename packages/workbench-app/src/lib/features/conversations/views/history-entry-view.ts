import type {
  ConversationEntry,
  ToolCallTranscriptRecord,
} from "$lib/presentation/view-models/conversation";
import {
  classifyHistoryEntry,
  type HistoryNodeDescriptor,
} from "./history-graph";

export type HistoryEntryView = {
  descriptor: HistoryNodeDescriptor;
  thinkingText: string;
  messageText: string;
  /** Tool call/result entries carry code or log text rather than prose. */
  isToolEntry: boolean;
};

function thinkingTextOf(entry: ConversationEntry): string {
  const blocks = (entry.details as { thinkingBlocks?: { text?: string }[] })
    ?.thinkingBlocks;
  if (!Array.isArray(blocks)) return "";
  return blocks
    .map((block) => block?.text ?? "")
    .filter(Boolean)
    .join("\n\n");
}

/** Presentation model for the inspector pane. */
export function buildHistoryEntryView(
  entry: ConversationEntry,
  toolCallsById: Map<string, ToolCallTranscriptRecord>,
): HistoryEntryView {
  const descriptor = classifyHistoryEntry(entry, toolCallsById);
  return {
    descriptor,
    thinkingText: thinkingTextOf(entry),
    messageText: entry.summary || entry.text,
    isToolEntry:
      descriptor.type === "tool_call" ||
      descriptor.type === "tool_result" ||
      descriptor.type === "human_loop",
  };
}
