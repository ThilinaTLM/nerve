import type { ToolCallRecord } from "$lib/api";
import type {
  CompactionNotice,
  ConversationLiveState,
  LiveToolCallDraft,
  LiveToolOutput,
  RunStatusNotice,
  TaskEventNotice,
  TranscriptItem,
} from "$lib/core/types/state-types";

export type TimelineItem =
  | { kind: "message"; key: string; item: TranscriptItem }
  | {
      kind: "tool";
      key: string;
      toolCall: ToolCallRecord;
      liveOutput?: LiveToolOutput;
      anchorEntryId?: string;
    }
  | { kind: "tool_draft"; key: string; draft: LiveToolCallDraft }
  | { kind: "compaction"; key: string; notice: CompactionNotice }
  | {
      kind: "tool_result_error";
      key: string;
      toolName: string;
      error: string;
    }
  | { kind: "run_status"; key: string; notice: RunStatusNotice }
  | { kind: "task_event"; key: string; notice: TaskEventNotice };

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

function toolCallAliasIds(toolCall: ToolCallRecord): string[] {
  return Array.from(
    new Set(
      [toolCall.sourceToolCallId, toolCall.providerToolCallId].filter(
        (value): value is string => Boolean(value),
      ),
    ),
  );
}

function isActiveRunPlacedToolCall(
  toolCall: ToolCallRecord,
  live: ConversationLiveState | undefined,
): boolean {
  return Boolean(
    live?.runId &&
      toolCall.runId === live.runId &&
      typeof toolCall.contentIndex === "number",
  );
}

function shouldAppendUnanchoredToolCall(
  toolCall: ToolCallRecord,
  liveOutput: LiveToolOutput | undefined,
  live: ConversationLiveState | undefined,
): boolean {
  return (
    isLiveToolCall(toolCall) ||
    Boolean(liveOutput) ||
    Boolean(live?.runId && toolCall.runId === live.runId)
  );
}

function liveOutputFor(
  live: ConversationLiveState | undefined,
  toolCallId: string,
): LiveToolOutput | undefined {
  return live?.toolOutputByToolCallId[toolCallId];
}

function contentIndexOf(
  item: TranscriptItem | LiveToolCallDraft | ToolCallRecord,
): number {
  return typeof item.contentIndex === "number"
    ? item.contentIndex
    : Number.MAX_SAFE_INTEGER;
}

type LiveTimelineNode =
  | { type: "message"; item: TranscriptItem }
  | { type: "draft"; draft: LiveToolCallDraft }
  | { type: "tool"; toolCall: ToolCallRecord };

function liveMessageIdFromKey(key: string | undefined): string | undefined {
  const match = key?.match(/^live:([^:]+):/);
  return match?.[1];
}

function liveNodeMessageId(node: LiveTimelineNode): string | undefined {
  if (node.type === "message") return liveMessageIdFromKey(node.item.id);
  if (node.type === "draft") return liveMessageIdFromKey(node.draft.key);
  return node.toolCall.liveMessageId;
}

function liveNodeContentIndex(node: LiveTimelineNode): number {
  if (node.type === "message") return contentIndexOf(node.item);
  if (node.type === "draft") return contentIndexOf(node.draft);
  return contentIndexOf(node.toolCall);
}

function liveNodeCreatedAt(node: LiveTimelineNode): string {
  if (node.type === "message") return node.item.createdAt ?? "";
  if (node.type === "draft") return node.draft.createdAt;
  return node.toolCall.createdAt;
}

function liveNodeStableKey(node: LiveTimelineNode): string {
  if (node.type === "message") return node.item.id ?? "";
  if (node.type === "draft") return node.draft.key;
  return node.toolCall.id;
}

function liveNodeTypePriority(node: LiveTimelineNode): number {
  if (node.type === "message") return 0;
  if (node.type === "draft") return 1;
  return 2;
}

function liveMessageOrder(nodes: LiveTimelineNode[]): Map<string, number> {
  const firstByMessageId = new Map<
    string,
    { createdAt: string; sequence: number }
  >();
  for (const [sequence, node] of nodes.entries()) {
    const messageId = liveNodeMessageId(node);
    if (!messageId) continue;
    const createdAt = liveNodeCreatedAt(node);
    const current = firstByMessageId.get(messageId);
    if (current && (current.createdAt || "9999") <= (createdAt || "9999")) {
      continue;
    }
    firstByMessageId.set(messageId, { createdAt, sequence });
  }

  return new Map(
    [...firstByMessageId.entries()]
      .sort(([, a], [, b]) => {
        const createdAtCmp = (a.createdAt || "9999").localeCompare(
          b.createdAt || "9999",
        );
        return createdAtCmp !== 0 ? createdAtCmp : a.sequence - b.sequence;
      })
      .map(([messageId], index) => [messageId, index]),
  );
}

function compareLiveTimelineNodes(
  order: Map<string, number>,
  a: LiveTimelineNode,
  b: LiveTimelineNode,
): number {
  const aMessageOrder = order.get(liveNodeMessageId(a) ?? "") ?? order.size;
  const bMessageOrder = order.get(liveNodeMessageId(b) ?? "") ?? order.size;
  if (aMessageOrder !== bMessageOrder) return aMessageOrder - bMessageOrder;

  const aIndex = liveNodeContentIndex(a);
  const bIndex = liveNodeContentIndex(b);
  if (aIndex !== bIndex) return aIndex - bIndex;

  const aPriority = liveNodeTypePriority(a);
  const bPriority = liveNodeTypePriority(b);
  if (aPriority !== bPriority) return aPriority - bPriority;

  const createdAtCmp = liveNodeCreatedAt(a).localeCompare(liveNodeCreatedAt(b));
  return createdAtCmp !== 0
    ? createdAtCmp
    : liveNodeStableKey(a).localeCompare(liveNodeStableKey(b));
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
  const orderedToolCalls = toolCalls
    .filter((toolCall) => !toolCall.hidden)
    .sort(byCreatedAtAscending);
  const toolCallsById = new Map(
    orderedToolCalls.map((toolCall) => [toolCall.id, toolCall]),
  );
  const toolCallsByProviderId = new Map<string, ToolCallRecord>();
  for (const toolCall of orderedToolCalls) {
    for (const alias of toolCallAliasIds(toolCall)) {
      if (!toolCallsByProviderId.has(alias)) {
        toolCallsByProviderId.set(alias, toolCall);
      }
    }
  }
  const consumedToolCallIds = new Set<string>();

  const hiddenEntryIds = new Set(live?.hiddenEntryIds ?? []);
  if (live?.runStatus?.failedEntryId) {
    hiddenEntryIds.add(live.runStatus.failedEntryId);
  }
  if (live?.compaction?.failedEntryId) {
    hiddenEntryIds.add(live.compaction.failedEntryId);
  }
  const hiddenFailedRunIds = new Set<string>();
  for (const item of transcript) {
    if (item.runStatus?.failedEntryId)
      hiddenEntryIds.add(item.runStatus.failedEntryId);
    if (item.runStatus?.runId) hiddenFailedRunIds.add(item.runStatus.runId);
  }
  if (live?.runStatus?.runId) hiddenFailedRunIds.add(live.runStatus.runId);
  const itemHidden = (item: TranscriptItem) =>
    Boolean(
      (item.id &&
        [...hiddenEntryIds].some(
          (entryId) =>
            item.id === entryId || item.id?.startsWith(`${entryId}:`),
        )) ||
        (item.role === "assistant" &&
          item.stopReason === "error" &&
          Boolean(item.runId && hiddenFailedRunIds.has(item.runId))),
    );

  transcript.forEach((item, index) => {
    if (isToolCallPlaceholder(item)) return;
    if (item.compaction) {
      items.push({
        kind: "compaction",
        key: item.compaction.entryId ?? item.id ?? `compaction-${index}`,
        notice: item.compaction,
      });
      return;
    }
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
    if (item.taskEvent) {
      items.push({
        kind: "task_event",
        key: item.taskEvent.entryId ?? item.id ?? `task-event-${index}`,
        notice: item.taskEvent,
      });
      return;
    }
    if (itemHidden(item)) return;

    const toolCall = item.toolRecordId
      ? toolCallsById.get(item.toolRecordId)
      : item.toolCallId
        ? toolCallsByProviderId.get(item.toolCallId)
        : undefined;
    if (toolCall) {
      items.push({
        kind: "tool",
        key: toolCall.id,
        toolCall,
        liveOutput: liveOutputFor(live, toolCall.id),
        anchorEntryId: item.id,
      });
      consumedToolCallIds.add(toolCall.id);
      return;
    }

    if (item.role === "system" && item.isToolError && item.toolName) {
      items.push({
        kind: "tool_result_error",
        key: item.id ?? `tool-result-error-${index}`,
        toolName: item.toolName,
        error: item.text,
      });
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
      node.kind === "run_status" && node.notice.runId
        ? [node.notice.runId]
        : [],
    ),
  );
  const completedCompactionKeys = new Set(
    items.flatMap((node) => {
      if (node.kind !== "compaction") return [];
      const keys = [node.notice.id, node.notice.entryId].filter(
        (value): value is string => Boolean(value),
      );
      if (node.notice.runId) keys.push(`run:${node.notice.runId}`);
      return keys;
    }),
  );

  const liveNodes: LiveTimelineNode[] = [
    ...(live?.messages ?? []).map((item) => ({
      type: "message" as const,
      item,
    })),
    ...(live?.toolDrafts ?? []).map((draft) => ({
      type: "draft" as const,
      draft,
    })),
    ...orderedToolCalls
      .filter((toolCall) => isActiveRunPlacedToolCall(toolCall, live))
      .map((toolCall) => ({
        type: "tool" as const,
        toolCall,
      })),
  ];
  const messageOrder = liveMessageOrder(liveNodes);
  liveNodes.sort((a, b) => compareLiveTimelineNodes(messageOrder, a, b));

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

    if (node.type === "tool") {
      if (!consumedToolCallIds.has(node.toolCall.id)) {
        items.push({
          kind: "tool",
          key: node.toolCall.id,
          toolCall: node.toolCall,
          liveOutput: liveOutputFor(live, node.toolCall.id),
        });
        consumedToolCallIds.add(node.toolCall.id);
      }
      continue;
    }

    const matchingToolCall = node.draft.providerToolCallId
      ? toolCallsByProviderId.get(node.draft.providerToolCallId)
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

  if (live?.compaction) {
    const duplicateKeys = [
      live.compaction.id,
      live.compaction.entryId,
      live.compaction.runId ? `run:${live.compaction.runId}` : undefined,
    ].filter((value): value is string => Boolean(value));
    if (!duplicateKeys.some((key) => completedCompactionKeys.has(key))) {
      items.push({
        kind: "compaction",
        key: live.compaction.id,
        notice: live.compaction,
      });
    }
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
