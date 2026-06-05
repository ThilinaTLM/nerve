import type { SessionEntry } from "../../api";
import type { TranscriptItem } from "./state.svelte";

const TOOL_CALL_PLACEHOLDER = /^\[Tool call:[\s\S]*\]$/;

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function startsWithToolPrefix(value: unknown): string | undefined {
  return typeof value === "string" && value.startsWith("tool_")
    ? value
    : undefined;
}

function thinkingBlocks(
  value: unknown,
): Array<{ text: string; redacted?: boolean }> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((block) => {
    if (!block || typeof block !== "object") return [];
    const record = block as Record<string, unknown>;
    const text = typeof record.text === "string" ? record.text : "";
    const redacted = record.redacted === true;
    return text.length > 0 || redacted ? [{ text, redacted }] : [];
  });
}

function entryDetails(
  entry: SessionEntry,
): Record<string, unknown> | undefined {
  return entry.details && typeof entry.details === "object"
    ? (entry.details as Record<string, unknown>)
    : undefined;
}

function toolMetadata(entry: SessionEntry): {
  toolCallId?: string;
  toolRecordId?: string;
} {
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
    toolCallId: stringValue(details?.toolCallId),
    toolRecordId:
      startsWithToolPrefix(details?.toolRecordId) ??
      startsWithToolPrefix(nestedToolCall?.id),
  };
}

export function entryToTranscriptItems(entry: SessionEntry): TranscriptItem[] {
  const details = entryDetails(entry);
  const metadata = toolMetadata(entry);
  const items: TranscriptItem[] = [];
  const blocks = thinkingBlocks(details?.thinkingBlocks);

  for (const [index, block] of blocks.entries()) {
    items.push({
      id: `${entry.id}:thinking:${index}`,
      role: "assistant",
      kind: entry.kind,
      displayKind: "thinking",
      text: block.text,
      redacted: block.redacted,
      createdAt: entry.createdAt,
    });
  }

  const isToolOnlyAssistantPlaceholder =
    entry.role === "assistant" && TOOL_CALL_PLACEHOLDER.test(entry.text.trim());

  if (!isToolOnlyAssistantPlaceholder || entry.role !== "assistant") {
    items.push({
      id: entry.id,
      role: entry.role,
      kind: entry.kind,
      displayKind: "message",
      text: entry.text,
      createdAt: entry.createdAt,
      ...metadata,
    });
  }

  return items;
}

export function entryToTranscriptItem(
  entry: SessionEntry,
): TranscriptItem | undefined {
  const items = entryToTranscriptItems(entry);
  return items.find((item) => item.displayKind !== "thinking") ?? items.at(-1);
}

function shouldIncludeEntry(entry: SessionEntry): boolean {
  if (entry.role === "user" || entry.role === "assistant") return true;
  if (entry.kind !== "message") return true;
  const metadata = toolMetadata(entry);
  return Boolean(metadata.toolCallId || metadata.toolRecordId);
}

export function entriesToTranscript(entries: SessionEntry[]): TranscriptItem[] {
  return entries.filter(shouldIncludeEntry).flatMap(entryToTranscriptItems);
}
