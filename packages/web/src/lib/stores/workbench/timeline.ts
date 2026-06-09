import type { ToolCallRecord } from "../../api";
import type {
  ConversationLiveState,
  LiveToolCallDraft,
  LiveToolOutput,
  RunStatusNotice,
  TranscriptItem,
} from "./state.svelte";

export type TimelineItem =
  | { kind: "message"; key: string; item: TranscriptItem }
  | {
      kind: "tool";
      key: string;
      toolCall: ToolCallRecord;
      liveOutput?: LiveToolOutput;
    }
  | { kind: "tool_draft"; key: string; draft: LiveToolCallDraft }
  | { kind: "run_status"; key: string; notice: RunStatusNotice };

const TOOL_CALL_PLACEHOLDER = /^\[Tool call:[\s\S]*\]$/;

function isToolCallPlaceholder(item: TranscriptItem): boolean {
  return (
    item.role === "assistant" &&
    item.displayKind !== "thinking" &&
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

function shouldAppendUnanchoredToolCall(
  toolCall: ToolCallRecord,
  liveOutput: LiveToolOutput | undefined,
  live: ConversationLiveState | undefined,
): boolean {
  return (
    isLiveToolCall(toolCall) || Boolean(liveOutput) || Boolean(live?.runId)
  );
}

function liveOutputFor(
  live: ConversationLiveState | undefined,
  toolCallId: string,
): LiveToolOutput | undefined {
  return live?.toolOutputByToolCallId[toolCallId];
}

function contentIndexOf(item: TranscriptItem | LiveToolCallDraft): number {
  return typeof item.contentIndex === "number"
    ? item.contentIndex
    : Number.MAX_SAFE_INTEGER;
}

function runStatusTimelineKey(
  notice: RunStatusNotice,
  fallback: string,
): string {
  return notice.runId ? `run-status:${notice.runId}` : fallback;
}

/**
 * Merge persisted branch entries, live assistant content, tool-call drafts, and
 * live/unanchored tool records into one renderer-facing conversation timeline.
 * Persisted branch entries remain source of truth; live nodes are transient
 * first-class transcript nodes appended at the current branch tail.
 */
export function buildConversationTimeline(
  transcript: TranscriptItem[],
  toolCalls: ToolCallRecord[],
  live?: ConversationLiveState,
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

  const hiddenEntryIds = new Set(live?.hiddenEntryIds ?? []);
  if (live?.runStatus?.failedEntryId) {
    hiddenEntryIds.add(live.runStatus.failedEntryId);
  }
  const hiddenFailedRunIds = new Set<string>();
  for (const item of transcript) {
    if (item.runStatus?.failedEntryId) hiddenEntryIds.add(item.runStatus.failedEntryId);
    if (item.runStatus?.runId) hiddenFailedRunIds.add(item.runStatus.runId);
  }
  if (live?.runStatus?.runId) hiddenFailedRunIds.add(live.runStatus.runId);
  const itemHidden = (item: TranscriptItem) =>
    Boolean(
      (item.id &&
        [...hiddenEntryIds].some(
          (entryId) => item.id === entryId || item.id?.startsWith(`${entryId}:`),
        )) ||
        (item.role === "assistant" &&
          item.stopReason === "error" &&
          Boolean(item.runId && hiddenFailedRunIds.has(item.runId))),
    );

  transcript.forEach((item, index) => {
    if (isToolCallPlaceholder(item)) return;
    if (item.runStatus) {
      items.push({
        kind: "run_status",
        key: runStatusTimelineKey(
          item.runStatus,
          item.id ?? `run-status-${index}`,
        ),
        notice: item.runStatus,
      });
      return;
    }
    if (itemHidden(item)) return;

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
        liveOutput: liveOutputFor(live, toolCall.id),
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

  const statusRunIds = new Set(
    items.flatMap((node) =>
      node.kind === "run_status" && node.notice.runId ? [node.notice.runId] : [],
    ),
  );

  const liveNodes = [
    ...(live?.messages ?? []).map((item) => ({
      type: "message" as const,
      item,
    })),
    ...(live?.toolDrafts ?? []).map((draft) => ({
      type: "draft" as const,
      draft,
    })),
  ].sort((a, b) => {
    const aIndex = contentIndexOf(a.type === "message" ? a.item : a.draft);
    const bIndex = contentIndexOf(b.type === "message" ? b.item : b.draft);
    if (aIndex !== bIndex) return aIndex - bIndex;
    return a.type.localeCompare(b.type);
  });

  for (const node of liveNodes) {
    if (node.type === "message") {
      if (!node.item.text && node.item.displayKind !== "thinking") continue;
      items.push({
        kind: "message",
        key:
          node.item.id ?? `live-msg-${node.item.contentIndex ?? items.length}`,
        item: node.item,
      });
      continue;
    }

    const matchingToolCall = node.draft.providerToolCallId
      ? toolCallsBySourceId.get(node.draft.providerToolCallId)
      : undefined;
    if (matchingToolCall) {
      if (!consumedToolCallIds.has(matchingToolCall.id)) {
        items.push({
          kind: "tool",
          key: matchingToolCall.id,
          toolCall: matchingToolCall,
          liveOutput: liveOutputFor(live, matchingToolCall.id),
        });
        consumedToolCallIds.add(matchingToolCall.id);
      }
      continue;
    }

    items.push({
      kind: "tool_draft",
      key: node.draft.key,
      draft: node.draft,
    });
  }

  if (live?.runStatus && !statusRunIds.has(live.runStatus.runId ?? "")) {
    items.push({
      kind: "run_status",
      key: runStatusTimelineKey(
        live.runStatus,
        `live:run-status:${live.runStatus.runId ?? live.runId ?? "active"}`,
      ),
      notice: live.runStatus,
    });
  }

  for (const toolCall of orderedToolCalls) {
    const liveOutput = liveOutputFor(live, toolCall.id);
    if (
      consumedToolCallIds.has(toolCall.id) ||
      !shouldAppendUnanchoredToolCall(toolCall, liveOutput, live)
    ) {
      continue;
    }
    items.push({
      kind: "tool",
      key: toolCall.id,
      toolCall,
      liveOutput,
    });
  }

  return items;
}
