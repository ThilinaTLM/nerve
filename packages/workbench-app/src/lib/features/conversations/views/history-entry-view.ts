import type { ConversationEntry, ToolCallTranscriptRecord } from "$lib/api";
import {
  classifyHistoryEntry,
  parseToolCallNames,
  resolveToolCallForEntry,
  type HistoryNodeDescriptor,
} from "./history-graph";

export type HistoryEntryView = {
  descriptor: HistoryNodeDescriptor;
  record?: ToolCallTranscriptRecord;
  thinkingText: string;
  messageText: string;
  isToolEntry: boolean;
  toolName?: string;
  argsText: string;
  resultText: string;
  errorText: string;
  timingText: string;
  detailPreview: string;
};

function asThinkingBlocks(
  entry: ConversationEntry,
): { text?: string }[] | undefined {
  const details = entry.details as
    | { thinkingBlocks?: { text?: string }[] }
    | undefined;
  return Array.isArray(details?.thinkingBlocks)
    ? details.thinkingBlocks
    : undefined;
}

export function formatHistoryValue(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function boundedHistoryExcerpt(value: string, maxLength = 560): string {
  const text = value.trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function meaningfulValue(value: unknown): boolean {
  if (value === undefined || value === null || value === "") return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value).length > 0;
  return true;
}

/** Build the shared presentation model used by graph cards and the inspector. */
export function buildHistoryEntryView(
  entry: ConversationEntry,
  toolCallsById: Map<string, ToolCallTranscriptRecord>,
  pairedResultEntry?: ConversationEntry,
): HistoryEntryView {
  const descriptor = classifyHistoryEntry(
    pairedResultEntry ?? entry,
    toolCallsById,
  );
  const record =
    resolveToolCallForEntry(entry, toolCallsById) ??
    (pairedResultEntry
      ? resolveToolCallForEntry(pairedResultEntry, toolCallsById)
      : undefined);
  const thinkingText = (asThinkingBlocks(entry) ?? [])
    .map((block) => block?.text ?? "")
    .filter(Boolean)
    .join("\n\n");
  const messageText = entry.summary || entry.text;
  const isToolEntry =
    descriptor.type === "tool_call" ||
    descriptor.type === "tool_result" ||
    descriptor.type === "human_loop";
  const toolName =
    record?.toolName ??
    parseToolCallNames(entry.text)[0] ??
    (entry.details as { toolName?: string } | undefined)?.toolName;
  const argsText = meaningfulValue(record?.argsPreview)
    ? formatHistoryValue(record?.argsPreview)
    : "";
  const resultEntry =
    pairedResultEntry ?? (entry.role === "system" ? entry : undefined);
  const resultValue = resultEntry?.text || record?.resultPreview;
  const resultText = meaningfulValue(resultValue)
    ? formatHistoryValue(resultValue)
    : "";
  const errorText = record?.error ?? "";
  const elapsedMs = record?.settledAt
    ? Date.parse(record.settledAt) - Date.parse(record.createdAt)
    : undefined;
  const timingText =
    elapsedMs !== undefined && Number.isFinite(elapsedMs) && elapsedMs >= 0
      ? elapsedMs < 1_000
        ? `${elapsedMs} ms`
        : `${(elapsedMs / 1_000).toFixed(elapsedMs < 10_000 ? 1 : 0)} s`
      : "";

  const detailText = isToolEntry
    ? errorText
      ? `Error\n${errorText}`
      : resultEntry && resultText
        ? argsText
          ? `Arguments\n${argsText}\n\nResult\n${resultText}`
          : `Result\n${resultText}`
        : argsText
          ? `Arguments\n${argsText}`
          : resultText
            ? `Result\n${resultText}`
            : descriptor.preview
    : messageText || thinkingText || descriptor.preview;

  return {
    descriptor,
    record,
    thinkingText,
    messageText,
    isToolEntry,
    toolName,
    argsText,
    resultText,
    errorText,
    timingText,
    detailPreview: boundedHistoryExcerpt(detailText),
  };
}
