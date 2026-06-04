import type { SessionEntry } from "../../api";
import type { ThinkingBlockItem, TranscriptItem } from "./state.svelte";

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function startsWithToolPrefix(value: unknown): string | undefined {
  return typeof value === "string" && value.startsWith("tool_")
    ? value
    : undefined;
}

function thinkingBlocks(value: unknown): ThinkingBlockItem[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const blocks = value.flatMap((block) => {
    if (!block || typeof block !== "object") return [];
    const record = block as Record<string, unknown>;
    const text = typeof record.text === "string" ? record.text : "";
    const redacted = record.redacted === true;
    return text.length > 0 || redacted ? [{ text, redacted }] : [];
  });
  return blocks.length > 0 ? blocks : undefined;
}

function entryDetails(
  entry: SessionEntry,
): Record<string, unknown> | undefined {
  return entry.details && typeof entry.details === "object"
    ? (entry.details as Record<string, unknown>)
    : undefined;
}

export function entryToTranscriptItem(entry: SessionEntry): TranscriptItem {
  const details = entryDetails(entry);
  const nestedDetails =
    details?.details && typeof details.details === "object"
      ? (details.details as Record<string, unknown>)
      : undefined;
  const nestedToolCall =
    nestedDetails?.toolCall && typeof nestedDetails.toolCall === "object"
      ? (nestedDetails.toolCall as Record<string, unknown>)
      : undefined;

  return {
    id: entry.id,
    role: entry.role,
    kind: entry.kind,
    text: entry.text,
    createdAt: entry.createdAt,
    toolCallId: stringValue(details?.toolCallId),
    toolRecordId:
      startsWithToolPrefix(details?.toolRecordId) ??
      startsWithToolPrefix(nestedToolCall?.id),
    thinkingBlocks: thinkingBlocks(details?.thinkingBlocks),
  };
}

function shouldIncludeEntry(entry: SessionEntry): boolean {
  if (entry.role === "user" || entry.role === "assistant") return true;
  if (entry.kind !== "message") return true;
  const item = entryToTranscriptItem(entry);
  return Boolean(item.toolCallId || item.toolRecordId);
}

export function entriesToTranscript(entries: SessionEntry[]): TranscriptItem[] {
  return entries.filter(shouldIncludeEntry).map(entryToTranscriptItem);
}
