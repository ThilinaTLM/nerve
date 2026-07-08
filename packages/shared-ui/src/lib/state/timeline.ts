import type { ToolCallTranscriptRecord } from "@nervekit/shared";
import type {
  CompactionNotice,
  ConversationLiveState,
  LiveToolCallDraft,
  LiveToolOutput,
  RunStatusNotice,
  TaskEventNotice,
  TranscriptItem,
} from "./transcript-types";

export type TimelineItem =
  | { kind: "message"; key: string; item: TranscriptItem }
  | {
      kind: "tool";
      key: string;
      toolCall: ToolCallTranscriptRecord;
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

/**
 * Memoizable products of the persisted-branch projection. `buildLiveTimeline`
 * consumes this so the live tail can be recomputed without re-walking the
 * (potentially huge) transcript or re-sorting the tool calls.
 */
export type CommittedContext = {
  orderedToolCalls: ToolCallTranscriptRecord[];
  toolCallsById: Map<string, ToolCallTranscriptRecord>;
  toolCallsByProviderId: Map<string, ToolCallTranscriptRecord>;
  toolCallsByRunId: Map<string, ToolCallTranscriptRecord[]>;
  /** Live-status tools that may need an unanchored live-tail card. */
  liveCandidateToolCalls: ToolCallTranscriptRecord[];
  /** Tool ids already rendered as anchored committed cards. */
  consumedToolCallIds: Set<string>;
  /** Run ids that already have a committed run-status node. */
  statusRunIds: Set<string>;
  /** Keys (id/entryId/`run:<id>`) of committed compaction notices. */
  completedCompactionKeys: Set<string>;
};

export type CommittedTimeline = {
  items: TimelineItem[];
  context: CommittedContext;
};

type BuildCommittedTimelineOptions = {
  includeUnanchoredTerminalToolCalls?: boolean;
};

const TOOL_CALL_PLACEHOLDER = /^\[Tool call:[\s\S]*\]$/;

function isToolCallPlaceholder(item: TranscriptItem): boolean {
  return (
    item.role === "assistant" &&
    item.displayKind !== "thinking" &&
    TOOL_CALL_PLACEHOLDER.test(item.text.trim())
  );
}

function byCreatedAtAscending(
  a: ToolCallTranscriptRecord,
  b: ToolCallTranscriptRecord,
): number {
  const cmp = a.createdAt.localeCompare(b.createdAt);
  return cmp !== 0 ? cmp : a.id.localeCompare(b.id);
}

function isLiveToolCall(toolCall: ToolCallTranscriptRecord): boolean {
  return (
    toolCall.status === "requested" ||
    toolCall.status === "pending_approval" ||
    toolCall.status === "waiting_for_user" ||
    toolCall.status === "running"
  );
}

function toolCallAliasIds(toolCall: ToolCallTranscriptRecord): string[] {
  return Array.from(
    new Set(
      [toolCall.sourceToolCallId, toolCall.providerToolCallId].filter(
        (value): value is string => Boolean(value),
      ),
    ),
  );
}

function isActiveRunPlacedToolCall(
  toolCall: ToolCallTranscriptRecord,
  live: ConversationLiveState | undefined,
): boolean {
  return Boolean(
    live?.runId &&
      toolCall.runId === live.runId &&
      typeof toolCall.contentIndex === "number",
  );
}

function shouldAppendUnanchoredToolCall(
  toolCall: ToolCallTranscriptRecord,
  liveOutput: LiveToolOutput | undefined,
  live: ConversationLiveState | undefined,
): boolean {
  // Tools actively streaming output always belong in the live tail.
  if (liveOutput) return true;
  // During an active run, only that run's tool calls belong in the live tail; a
  // stale live-status call from a finished run must not be pinned below the
  // current run's streaming content.
  if (live?.runId) return toolCall.runId === live.runId;
  // No active run: surface genuinely live tool calls. Stale ones are
  // terminalized by the orchestrator so they are no longer live-status here.
  return isLiveToolCall(toolCall);
}

function liveOutputFor(
  live: ConversationLiveState | undefined,
  toolCallId: string,
): LiveToolOutput | undefined {
  return live?.toolOutputByToolCallId[toolCallId];
}

function contentIndexOf(
  item: TranscriptItem | LiveToolCallDraft | ToolCallTranscriptRecord,
): number {
  return typeof item.contentIndex === "number"
    ? item.contentIndex
    : Number.MAX_SAFE_INTEGER;
}

type LiveTimelineNode =
  | { type: "message"; item: TranscriptItem }
  | { type: "draft"; draft: LiveToolCallDraft }
  | { type: "tool"; toolCall: ToolCallTranscriptRecord };

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

function entryIdMatches(itemId: string, entryId: string): boolean {
  return itemId === entryId || itemId.startsWith(`${entryId}:`);
}

function isHiddenByEntryIds(
  item: TranscriptItem,
  hiddenEntryIds: Set<string>,
): boolean {
  return Boolean(
    item.id &&
      [...hiddenEntryIds].some((entryId) =>
        entryIdMatches(item.id as string, entryId),
      ),
  );
}

function isHiddenByFailedRun(
  item: TranscriptItem,
  hiddenFailedRunIds: Set<string>,
): boolean {
  return (
    item.role === "assistant" &&
    item.stopReason === "error" &&
    Boolean(item.runId && hiddenFailedRunIds.has(item.runId))
  );
}

/**
 * Project the persisted branch transcript + tool calls into committed timeline
 * nodes. This pass is intentionally independent of live state so it can be
 * memoized while the agent streams: only `transcript`/`toolCalls` identity
 * changes invalidate it. Live-only hiding is layered in afterwards by
 * {@link selectVisibleCommitted}.
 */
export function buildCommittedTimeline(
  transcript: TranscriptItem[],
  toolCalls: ToolCallTranscriptRecord[],
  options: BuildCommittedTimelineOptions = {},
): CommittedTimeline {
  const items: TimelineItem[] = [];
  const orderedToolCalls = toolCalls
    .filter((toolCall) => !toolCall.hidden)
    .sort(byCreatedAtAscending);
  const toolCallsById = new Map(
    orderedToolCalls.map((toolCall) => [toolCall.id, toolCall]),
  );
  const toolCallsByProviderId = new Map<string, ToolCallTranscriptRecord>();
  const toolCallsByRunId = new Map<string, ToolCallTranscriptRecord[]>();
  const liveCandidateToolCalls: ToolCallTranscriptRecord[] = [];
  for (const toolCall of orderedToolCalls) {
    for (const alias of toolCallAliasIds(toolCall)) {
      if (!toolCallsByProviderId.has(alias)) {
        toolCallsByProviderId.set(alias, toolCall);
      }
    }
    if (toolCall.runId) {
      const runToolCalls = toolCallsByRunId.get(toolCall.runId) ?? [];
      runToolCalls.push(toolCall);
      toolCallsByRunId.set(toolCall.runId, runToolCalls);
    }
    if (isLiveToolCall(toolCall)) {
      liveCandidateToolCalls.push(toolCall);
    }
  }
  const consumedToolCallIds = new Set<string>();

  // Transcript-derived hiding (persisted run-status entries). Live-derived
  // hiding is applied later, so this pass stays live-independent.
  const hiddenEntryIds = new Set<string>();
  const hiddenFailedRunIds = new Set<string>();
  for (const item of transcript) {
    if (item.runStatus?.failedEntryId)
      hiddenEntryIds.add(item.runStatus.failedEntryId);
    if (item.runStatus?.runId) hiddenFailedRunIds.add(item.runStatus.runId);
  }
  const itemHidden = (item: TranscriptItem) =>
    isHiddenByEntryIds(item, hiddenEntryIds) ||
    isHiddenByFailedRun(item, hiddenFailedRunIds);

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

  const unanchoredTerminalToolCalls =
    (options.includeUnanchoredTerminalToolCalls ?? true) &&
    liveCandidateToolCalls.length === 0
      ? orderedToolCalls.filter(
          (toolCall) =>
            !consumedToolCallIds.has(toolCall.id) &&
            isTerminalUnanchoredToolCall(toolCall),
        )
      : [];
  if (unanchoredTerminalToolCalls.length > 0) {
    for (const toolCall of unanchoredTerminalToolCalls) {
      items.push({
        kind: "tool",
        key: toolCall.id,
        toolCall,
      });
      consumedToolCallIds.add(toolCall.id);
    }
    stableSortTimelineItemsByCreatedAt(items);
  }

  return {
    items,
    context: {
      orderedToolCalls,
      toolCallsById,
      toolCallsByProviderId,
      toolCallsByRunId,
      liveCandidateToolCalls,
      consumedToolCallIds,
      statusRunIds,
      completedCompactionKeys,
    },
  };
}

function isTerminalUnanchoredToolCall(
  toolCall: ToolCallTranscriptRecord,
): boolean {
  return (
    toolCall.status === "completed" ||
    toolCall.status === "error" ||
    toolCall.status === "denied"
  );
}

function timelineItemCreatedAt(item: TimelineItem): string | undefined {
  if (item.kind === "message") return item.item.createdAt;
  if (item.kind === "tool") return item.toolCall.createdAt;
  if (item.kind === "tool_draft") return item.draft.createdAt;
  if (item.kind === "compaction") return item.notice.createdAt;
  if (item.kind === "run_status") return item.notice.createdAt;
  if (item.kind === "task_event") return item.notice.createdAt;
  return undefined;
}

function stableSortTimelineItemsByCreatedAt(items: TimelineItem[]): void {
  const indexed = items.map((item, index) => ({
    item,
    index,
    createdAt: timelineItemCreatedAt(item),
  }));
  indexed.sort((a, b) => {
    if (a.createdAt && b.createdAt && a.createdAt !== b.createdAt)
      return a.createdAt.localeCompare(b.createdAt);
    return a.index - b.index;
  });
  items.splice(0, items.length, ...indexed.map((entry) => entry.item));
}

function committedEntryId(item: TimelineItem): string | undefined {
  if (item.kind === "message") return item.item.id;
  if (item.kind === "tool") return item.anchorEntryId;
  if (item.kind === "tool_result_error") return item.key;
  return undefined;
}

/**
 * Filter committed items that live state hides (retry/compaction in progress).
 * Returns the same array reference when nothing is hidden — the common case
 * during pure text streaming — so the timeline concat stays cheap.
 */
export function selectVisibleCommitted(
  items: TimelineItem[],
  live: ConversationLiveState | undefined,
): TimelineItem[] {
  const liveHiddenEntryIds = new Set<string>(live?.hiddenEntryIds ?? []);
  if (live?.runStatus?.failedEntryId)
    liveHiddenEntryIds.add(live.runStatus.failedEntryId);
  if (live?.compaction?.failedEntryId)
    liveHiddenEntryIds.add(live.compaction.failedEntryId);
  const liveHiddenRunId = live?.runStatus?.runId;

  if (liveHiddenEntryIds.size === 0 && !liveHiddenRunId) return items;

  const hiddenEntryIds = [...liveHiddenEntryIds];

  return items.filter((item) => {
    const entryId = committedEntryId(item);
    if (
      entryId &&
      hiddenEntryIds.some((hidden) => entryIdMatches(entryId, hidden))
    ) {
      return false;
    }
    if (
      liveHiddenRunId &&
      item.kind === "message" &&
      item.item.role === "assistant" &&
      item.item.stopReason === "error" &&
      item.item.runId === liveHiddenRunId
    ) {
      return false;
    }
    return true;
  });
}

/**
 * Project the transient live tail (streaming assistant content, tool drafts,
 * unanchored/active-run tool cards, run-status, compaction) using the memoized
 * committed `context` instead of recomputing it.
 */
export function buildLiveTimeline(
  live: ConversationLiveState | undefined,
  context: CommittedContext,
): TimelineItem[] {
  const items: TimelineItem[] = [];
  const {
    toolCallsById,
    toolCallsByProviderId,
    toolCallsByRunId,
    liveCandidateToolCalls,
    statusRunIds,
    completedCompactionKeys,
  } = context;
  const liveConsumedToolCallIds = new Set<string>();
  const activeRunToolCalls = live?.runId
    ? (toolCallsByRunId.get(live.runId) ?? [])
    : [];

  const isToolConsumed = (toolCallId: string) =>
    context.consumedToolCallIds.has(toolCallId) ||
    liveConsumedToolCallIds.has(toolCallId);
  const consumeTool = (toolCallId: string) => {
    liveConsumedToolCallIds.add(toolCallId);
  };

  const liveNodes: LiveTimelineNode[] = [
    ...(live?.messages ?? []).map((item) => ({
      type: "message" as const,
      item,
    })),
    ...(live?.toolDrafts ?? []).map((draft) => ({
      type: "draft" as const,
      draft,
    })),
    ...activeRunToolCalls
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
      if (!isToolConsumed(node.toolCall.id)) {
        items.push({
          kind: "tool",
          key: node.toolCall.id,
          toolCall: node.toolCall,
          liveOutput: liveOutputFor(live, node.toolCall.id),
        });
        consumeTool(node.toolCall.id);
      }
      continue;
    }

    const matchingToolCall = node.draft.providerToolCallId
      ? toolCallsByProviderId.get(node.draft.providerToolCallId)
      : undefined;
    if (matchingToolCall) {
      if (!isToolConsumed(matchingToolCall.id)) {
        items.push({
          kind: "tool",
          key: matchingToolCall.id,
          toolCall: matchingToolCall,
          liveOutput: liveOutputFor(live, matchingToolCall.id),
        });
        consumeTool(matchingToolCall.id);
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

  const unanchoredToolCandidates = new Map<string, ToolCallTranscriptRecord>();
  const addUnanchoredCandidate = (
    toolCall: ToolCallTranscriptRecord | undefined,
  ) => {
    if (toolCall && !unanchoredToolCandidates.has(toolCall.id)) {
      unanchoredToolCandidates.set(toolCall.id, toolCall);
    }
  };

  for (const toolCall of liveCandidateToolCalls)
    addUnanchoredCandidate(toolCall);
  for (const toolCall of activeRunToolCalls) addUnanchoredCandidate(toolCall);
  for (const toolCallId of Object.keys(live?.toolOutputByToolCallId ?? {})) {
    addUnanchoredCandidate(toolCallsById.get(toolCallId));
  }

  for (const toolCall of [...unanchoredToolCandidates.values()].sort(
    byCreatedAtAscending,
  )) {
    const liveOutput = liveOutputFor(live, toolCall.id);
    if (
      isToolConsumed(toolCall.id) ||
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

/**
 * Merge persisted branch entries, live assistant content, tool-call drafts, and
 * live/unanchored tool records into one renderer-facing conversation timeline.
 * Thin compose over {@link buildCommittedTimeline} + {@link buildLiveTimeline};
 * the reactive UI calls those directly so the committed pass stays memoized.
 */
export function buildConversationTimeline(
  transcript: TranscriptItem[],
  toolCalls: ToolCallTranscriptRecord[],
  live?: ConversationLiveState,
): TimelineItem[] {
  const committed = buildCommittedTimeline(transcript, toolCalls, {
    includeUnanchoredTerminalToolCalls: !live,
  });
  const liveItems = buildLiveTimeline(live, committed.context);
  return [...selectVisibleCommitted(committed.items, live), ...liveItems];
}
