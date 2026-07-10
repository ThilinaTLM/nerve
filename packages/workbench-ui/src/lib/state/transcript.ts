import type { ConversationEntry } from "@nervekit/contracts";
import type {
  CompactionNotice,
  RunStatusNotice,
  TaskEventNotice,
  TranscriptItem,
} from "./transcript-types";

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
  entry: ConversationEntry,
): Record<string, unknown> | undefined {
  return entry.details && typeof entry.details === "object"
    ? (entry.details as Record<string, unknown>)
    : undefined;
}

function toolMetadata(entry: ConversationEntry): {
  toolCallId?: string;
  toolRecordId?: string;
  toolName?: string;
  isToolError?: boolean;
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
    toolName: stringValue(details?.toolName),
    isToolError: details?.isError === true,
  };
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function compactionReason(
  value: unknown,
): CompactionNotice["reason"] | undefined {
  return value === "manual" || value === "threshold" || value === "overflow"
    ? value
    : undefined;
}

function compactionNotice(
  entry: ConversationEntry,
): CompactionNotice | undefined {
  if (entry.kind !== "compaction") return undefined;
  const details = entryDetails(entry);
  const policy =
    details?.policy && typeof details.policy === "object"
      ? (details.policy as Record<string, unknown>)
      : undefined;
  const tokensAfter = numberValue(details?.tokensAfter);
  const freedTokens =
    numberValue(details?.freedTokens) ??
    (typeof entry.tokensBefore === "number" && typeof tokensAfter === "number"
      ? Math.max(0, entry.tokensBefore - tokensAfter)
      : undefined);
  return {
    id: entry.id,
    state: "completed",
    reason: compactionReason(details?.reason),
    entryId: entry.id,
    conversationId: entry.conversationId,
    agentId: stringValue(entry.agentId),
    runId: stringValue(entry.runId),
    text: entry.text,
    summary: entry.summary ?? entry.text,
    tokensBefore: entry.tokensBefore,
    tokensAfter,
    freedTokens,
    contextWindow: numberValue(policy?.contextWindow),
    thresholdTokens: numberValue(policy?.thresholdTokens),
    triggerReserveTokens: numberValue(policy?.triggerReserveTokens),
    keepRecentTokens: numberValue(policy?.keepRecentTokens),
    firstKeptEntryId: stringValue(entry.firstKeptEntryId),
    details: entry.details,
    createdAt: entry.createdAt,
    completedAt: entry.createdAt,
  };
}

function runStatusNotice(
  entry: ConversationEntry,
): RunStatusNotice | undefined {
  if (entry.kind !== "run_status") return undefined;
  const details = entryDetails(entry);
  if (details?.type !== "agent_run_retry_status") return undefined;
  const state = details.state;
  if (
    state !== "retrying" &&
    state !== "retry_exhausted" &&
    state !== "failed" &&
    state !== "interrupted"
  )
    return undefined;
  return {
    entryId: entry.id,
    conversationId: entry.conversationId,
    agentId: stringValue(entry.agentId),
    runId: stringValue(details.runId) ?? entry.runId,
    state,
    failedEntryId: stringValue(details.failedEntryId),
    attempt: typeof details.attempt === "number" ? details.attempt : undefined,
    maxRetries:
      typeof details.maxRetries === "number" ? details.maxRetries : undefined,
    delayMs: typeof details.delayMs === "number" ? details.delayMs : undefined,
    retryAt: stringValue(details.retryAt),
    errorMessage: stringValue(details.errorMessage),
    retryable: details.retryable === true,
    createdAt: entry.createdAt,
  };
}

function taskEventNotice(
  entry: ConversationEntry,
): TaskEventNotice | undefined {
  if (entry.kind !== "task_event") return undefined;
  const details = entryDetails(entry);
  if (details?.type !== "task_event") return undefined;
  return {
    entryId: entry.id,
    conversationId: entry.conversationId,
    agentId: stringValue(entry.agentId),
    runId: stringValue(entry.runId),
    taskId: stringValue(details.taskId),
    taskName: stringValue(details.taskName),
    groupId: stringValue(details.groupId),
    groupName: stringValue(details.groupName),
    event: stringValue(details.event),
    status: stringValue(details.status),
    exitCode: numberValue(details.exitCode),
    signal: stringValue(details.signal),
    commandPreview: stringValue(details.commandPreview),
    nextCursor: numberValue(details.nextCursor),
    createdAt: entry.createdAt,
  };
}

export function entryToTranscriptItems(
  entry: ConversationEntry,
): TranscriptItem[] {
  const compaction = compactionNotice(entry);
  if (compaction) {
    return [
      {
        id: entry.id,
        runId: entry.runId,
        role: "system",
        kind: entry.kind,
        displayKind: "message",
        text: entry.summary ?? entry.text,
        createdAt: entry.createdAt,
        compaction,
      },
    ];
  }

  const status = runStatusNotice(entry);
  if (status) {
    return [
      {
        id: entry.id,
        role: "system",
        kind: entry.kind,
        displayKind: "message",
        text: entry.text,
        createdAt: entry.createdAt,
        runStatus: status,
      },
    ];
  }

  const taskEvent = taskEventNotice(entry);
  if (taskEvent) {
    return [
      {
        id: entry.id,
        runId: entry.runId,
        role: "system",
        kind: entry.kind,
        displayKind: "message",
        text: entry.text,
        createdAt: entry.createdAt,
        taskEvent,
      },
    ];
  }

  const details = entryDetails(entry);
  const metadata = toolMetadata(entry);
  const stopReason =
    details?.stopReason === "error" || details?.stopReason === "aborted"
      ? details.stopReason
      : undefined;
  const errorMessage = stringValue(details?.errorMessage);
  const items: TranscriptItem[] = [];
  const blocks = thinkingBlocks(details?.thinkingBlocks);

  for (const [index, block] of blocks.entries()) {
    items.push({
      id: `${entry.id}:thinking:${index}`,
      runId: entry.runId,
      role: "assistant",
      kind: entry.kind,
      displayKind: "thinking",
      text: block.text,
      redacted: block.redacted,
      createdAt: entry.createdAt,
      stopReason,
      errorMessage,
    });
  }

  const isToolOnlyAssistantPlaceholder =
    entry.role === "assistant" && TOOL_CALL_PLACEHOLDER.test(entry.text.trim());

  if (!isToolOnlyAssistantPlaceholder || entry.role !== "assistant") {
    items.push({
      id: entry.id,
      runId: entry.runId,
      role: entry.role,
      kind: entry.kind,
      displayKind: "message",
      text: entry.text,
      createdAt: entry.createdAt,
      usage: entry.usage,
      stopReason,
      errorMessage,
      ...metadata,
    });
  }

  return items;
}

export function entryToTranscriptItem(
  entry: ConversationEntry,
): TranscriptItem | undefined {
  const items = entryToTranscriptItems(entry);
  return items.find((item) => item.displayKind !== "thinking") ?? items.at(-1);
}

function shouldIncludeEntry(entry: ConversationEntry): boolean {
  if (entry.role === "user" || entry.role === "assistant") return true;
  if (entry.kind !== "message") return true;
  const metadata = toolMetadata(entry);
  return Boolean(metadata.toolCallId || metadata.toolRecordId);
}

export function entriesToTranscript(
  entries: ConversationEntry[],
): TranscriptItem[] {
  return entries.filter(shouldIncludeEntry).flatMap(entryToTranscriptItems);
}
