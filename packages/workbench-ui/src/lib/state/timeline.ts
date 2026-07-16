import type {
  ConversationActiveRunSnapshot,
  ConversationLiveMessageSnapshot,
  ConversationLiveToolOutputSnapshot,
  ConversationLiveTurnSnapshot,
  ToolCallTranscriptRecord,
} from "@nervekit/contracts";
import {
  liveBlockKey,
  orderedBlocks,
  orderedMessages,
  orderedTurns,
  toolSlotKey,
  type ToolDraftViewModel,
} from "./active-run.js";
import type {
  CompactionNotice,
  ConversationTransientState,
  RunStatusNotice,
  TaskEventNotice,
  TranscriptItem,
} from "./transcript-types.js";

/**
 * One tool content slot rendered as a single stable row across its whole
 * lifecycle. At least one of `draft` or `toolCall` is present: draft-only
 * while arguments stream, joined during the presentation handoff, tool-only
 * after the active run ends. A materialized message's retained draft is the
 * handoff bridge to the durable record, not a second tool card.
 */
export type ToolActivityTimelineItem = {
  kind: "tool";
  key: string;
  draft?: ToolDraftViewModel;
  toolCall?: ToolCallTranscriptRecord;
  liveOutput?: ConversationLiveToolOutputSnapshot;
  anchorEntryId?: string;
};

export type TimelineItem =
  | { kind: "message"; key: string; item: TranscriptItem }
  | ToolActivityTimelineItem
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
 * Memoizable products of the persisted-branch projection.
 * `buildActiveRunTimeline` consumes this so the live tail can be recomputed
 * without re-walking the (potentially huge) transcript or re-sorting the tool
 * calls.
 */
export type CommittedContext = {
  orderedToolCalls: ToolCallTranscriptRecord[];
  toolCallsById: Map<string, ToolCallTranscriptRecord>;
  toolCallsByProviderId: Map<string, ToolCallTranscriptRecord>;
  toolCallsByRunId: Map<string, ToolCallTranscriptRecord[]>;
  /** Anchored records by `tool-slot:` key for coordinate-first joining. */
  toolCallsBySlot: Map<string, ToolCallTranscriptRecord>;
  /** Live-status tools that may need an unanchored live-tail card. */
  liveCandidateToolCalls: ToolCallTranscriptRecord[];
  /** Tool ids already rendered as anchored committed cards. */
  consumedToolCallIds: Set<string>;
  /** Run ids that already have a committed run-status node. */
  statusRunIds: Set<string>;
  /** Run ids with visible assistant error entries (retry-hiding candidates). */
  failedAssistantRunIds: Set<string>;
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

function toolCallSlotKey(
  toolCall: ToolCallTranscriptRecord,
): string | undefined {
  return toolCall.liveMessageId && typeof toolCall.contentIndex === "number"
    ? toolSlotKey(toolCall.liveMessageId, toolCall.contentIndex)
    : undefined;
}

/**
 * Stable timeline key for a tool record: content-slot identity when the
 * record carries live coordinates (survives materialization), durable tool id
 * for genuinely unanchored/non-run tools.
 */
export function toolTimelineKey(toolCall: ToolCallTranscriptRecord): string {
  return toolCallSlotKey(toolCall) ?? `tool:${toolCall.id}`;
}

function shouldAppendUnanchoredToolCall(
  toolCall: ToolCallTranscriptRecord,
  liveOutput: ConversationLiveToolOutputSnapshot | undefined,
  activeRun: ConversationActiveRunSnapshot | undefined,
): boolean {
  // Tools actively streaming output always belong in the live tail.
  if (liveOutput) return true;
  // During an active run, only that run's tool calls belong in the live tail;
  // a stale live-status call from a finished run must not be pinned below the
  // current run's streaming content.
  if (activeRun) return toolCall.runId === activeRun.runId;
  // No active run: surface genuinely live tool calls. Stale ones are
  // terminalized by the orchestrator so they are no longer live-status here.
  return isLiveToolCall(toolCall);
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
 * nodes. This pass is intentionally independent of the active run so it can be
 * memoized while the agent streams: only `transcript`/`toolCalls` identity
 * changes invalidate it. Run-derived hiding is layered in afterwards by
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
  const toolCallsBySlot = new Map<string, ToolCallTranscriptRecord>();
  const liveCandidateToolCalls: ToolCallTranscriptRecord[] = [];
  for (const toolCall of orderedToolCalls) {
    for (const alias of toolCallAliasIds(toolCall)) {
      if (!toolCallsByProviderId.has(alias)) {
        toolCallsByProviderId.set(alias, toolCall);
      }
    }
    const slotKey = toolCallSlotKey(toolCall);
    if (slotKey && !toolCallsBySlot.has(slotKey)) {
      toolCallsBySlot.set(slotKey, toolCall);
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

  // Transcript-derived hiding (persisted run-status entries). Run-derived
  // hiding is applied later, so this pass stays run-independent.
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
        key: toolTimelineKey(toolCall),
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
  const failedAssistantRunIds = new Set(
    items.flatMap((node) =>
      node.kind === "message" &&
      node.item.role === "assistant" &&
      node.item.stopReason === "error" &&
      node.item.runId
        ? [node.item.runId]
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
        key: toolTimelineKey(toolCall),
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
      toolCallsBySlot,
      liveCandidateToolCalls,
      consumedToolCallIds,
      statusRunIds,
      failedAssistantRunIds,
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
  if (item.kind === "tool") return item.toolCall?.createdAt;
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
 * Filter committed items hidden by run/transient state (retry or compaction in
 * progress). Returns the same array reference when nothing is hidden — the
 * common case during pure text streaming — so the timeline concat stays cheap.
 *
 * While a run is active, every failed assistant error entry of that run is
 * hidden (not only the latest `failedEntryId`), so multi-attempt retries do
 * not resurrect earlier failures and a successful retry keeps superseded
 * attempts hidden while it streams.
 */
export function selectVisibleCommitted(
  items: TimelineItem[],
  activeRun: ConversationActiveRunSnapshot | undefined,
  transient: ConversationTransientState | undefined,
  context?: Pick<CommittedContext, "failedAssistantRunIds">,
): TimelineItem[] {
  const hiddenEntryIds = new Set<string>();
  if (activeRun?.retry?.failedEntryId) {
    hiddenEntryIds.add(activeRun.retry.failedEntryId);
  }
  if (
    transient?.compaction?.state === "running" &&
    transient.compaction.failedEntryId
  ) {
    hiddenEntryIds.add(transient.compaction.failedEntryId);
  }
  const hiddenRunId =
    activeRun &&
    (!context || context.failedAssistantRunIds.has(activeRun.runId))
      ? activeRun.runId
      : undefined;

  if (hiddenEntryIds.size === 0 && !hiddenRunId) return items;

  const hidden = [...hiddenEntryIds];

  return items.filter((item) => {
    const entryId = committedEntryId(item);
    if (entryId && hidden.some((value) => entryIdMatches(entryId, value))) {
      return false;
    }
    if (
      hiddenRunId &&
      item.kind === "message" &&
      item.item.role === "assistant" &&
      item.item.stopReason === "error" &&
      item.item.runId === hiddenRunId
    ) {
      return false;
    }
    return true;
  });
}

type MessageSlot =
  | { contentIndex: number; order: number; type: "block"; blockIndex: number }
  | {
      contentIndex: number;
      order: number;
      type: "tool";
      toolCall: ToolCallTranscriptRecord;
    };

function anchoredRunToolCallsByMessage(
  activeRun: ConversationActiveRunSnapshot | undefined,
  context: CommittedContext,
): Map<string, ToolCallTranscriptRecord[]> {
  const byMessage = new Map<string, ToolCallTranscriptRecord[]>();
  if (!activeRun) return byMessage;
  for (const toolCall of context.toolCallsByRunId.get(activeRun.runId) ?? []) {
    if (!toolCall.liveMessageId || typeof toolCall.contentIndex !== "number") {
      continue;
    }
    const list = byMessage.get(toolCall.liveMessageId) ?? [];
    list.push(toolCall);
    byMessage.set(toolCall.liveMessageId, list);
  }
  return byMessage;
}

/**
 * Project the transient live tail (streaming assistant content, unified tool
 * activities, run-status, compaction) directly from the canonical active-run
 * snapshot, using the memoized committed `context` instead of recomputing it.
 */
export function buildActiveRunTimeline(
  activeRun: ConversationActiveRunSnapshot | undefined,
  transient: ConversationTransientState | undefined,
  context: CommittedContext,
): TimelineItem[] {
  const items: TimelineItem[] = [];
  const liveConsumedToolCallIds = new Set<string>();
  const isToolConsumed = (toolCallId: string) =>
    context.consumedToolCallIds.has(toolCallId) ||
    liveConsumedToolCallIds.has(toolCallId);
  const consumeTool = (toolCallId: string) => {
    liveConsumedToolCallIds.add(toolCallId);
  };
  const liveOutputFor = (toolCallId: string) =>
    activeRun?.toolOutputsByToolCallId[toolCallId];

  const anchoredByMessage = anchoredRunToolCallsByMessage(activeRun, context);

  if (activeRun) {
    for (const turn of orderedTurns(activeRun)) {
      for (const message of orderedMessages(turn)) {
        emitMessageSlots(items, activeRun, turn, message, {
          context,
          anchoredToolCalls: anchoredByMessage.get(message.liveMessageId) ?? [],
          isToolConsumed,
          consumeTool,
          liveOutputFor,
        });
      }
    }
  }

  if (
    activeRun?.retry &&
    activeRun.status === "retrying" &&
    !context.statusRunIds.has(activeRun.runId)
  ) {
    items.push({
      kind: "run_status",
      key: `run-status:${activeRun.runId}`,
      notice: {
        conversationId: activeRun.conversationId,
        agentId: activeRun.agentId,
        runId: activeRun.runId,
        state: "retrying",
        ...activeRun.retry,
      },
    });
  }

  if (
    activeRun?.status === "interrupted" &&
    activeRun.recovery &&
    !context.statusRunIds.has(activeRun.runId)
  ) {
    items.push({
      kind: "run_status",
      key: `run-status:${activeRun.runId}`,
      notice: {
        conversationId: activeRun.conversationId,
        agentId: activeRun.agentId,
        runId: activeRun.runId,
        state: "interrupted",
        errorMessage: activeRun.recovery.errorMessage,
        retryable: activeRun.recovery.continuable,
      },
    });
  }

  if (transient?.compaction) {
    const duplicateKeys = [
      transient.compaction.id,
      transient.compaction.entryId,
      transient.compaction.runId
        ? `run:${transient.compaction.runId}`
        : undefined,
    ].filter((value): value is string => Boolean(value));
    if (
      !duplicateKeys.some((key) => context.completedCompactionKeys.has(key))
    ) {
      items.push({
        kind: "compaction",
        key: transient.compaction.id,
        notice: transient.compaction,
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

  for (const toolCall of context.liveCandidateToolCalls)
    addUnanchoredCandidate(toolCall);
  if (activeRun) {
    for (const toolCall of context.toolCallsByRunId.get(activeRun.runId) ?? [])
      addUnanchoredCandidate(toolCall);
    for (const toolCallId of Object.keys(activeRun.toolOutputsByToolCallId)) {
      addUnanchoredCandidate(context.toolCallsById.get(toolCallId));
    }
  }

  for (const toolCall of [...unanchoredToolCandidates.values()].sort(
    byCreatedAtAscending,
  )) {
    const liveOutput = liveOutputFor(toolCall.id);
    if (
      isToolConsumed(toolCall.id) ||
      !shouldAppendUnanchoredToolCall(toolCall, liveOutput, activeRun)
    ) {
      continue;
    }
    items.push({
      kind: "tool",
      key: toolTimelineKey(toolCall),
      toolCall,
      liveOutput,
    });
    consumeTool(toolCall.id);
  }

  return items;
}

function emitMessageSlots(
  items: TimelineItem[],
  activeRun: ConversationActiveRunSnapshot,
  turn: ConversationLiveTurnSnapshot,
  message: ConversationLiveMessageSnapshot,
  input: {
    context: CommittedContext;
    anchoredToolCalls: ToolCallTranscriptRecord[];
    isToolConsumed: (toolCallId: string) => boolean;
    consumeTool: (toolCallId: string) => void;
    liveOutputFor: (
      toolCallId: string,
    ) => ConversationLiveToolOutputSnapshot | undefined;
  },
): void {
  const blocks = orderedBlocks(message);
  const slots: MessageSlot[] = blocks.map((block, blockIndex) => ({
    contentIndex: block.contentIndex,
    order: 0,
    type: "block",
    blockIndex,
  }));
  const draftIndexes = new Set(
    blocks
      .filter((block) => block.kind === "tool_call_draft")
      .map((block) => block.contentIndex),
  );
  // Anchored run tools whose transient draft events were missed still render
  // in their canonical slot position.
  for (const toolCall of input.anchoredToolCalls) {
    if (draftIndexes.has(toolCall.contentIndex as number)) continue;
    slots.push({
      contentIndex: toolCall.contentIndex as number,
      order: 1,
      type: "tool",
      toolCall,
    });
  }
  slots.sort((a, b) =>
    a.contentIndex !== b.contentIndex
      ? a.contentIndex - b.contentIndex
      : a.order - b.order,
  );

  for (const slot of slots) {
    if (slot.type === "tool") {
      if (input.isToolConsumed(slot.toolCall.id)) continue;
      items.push({
        kind: "tool",
        key: toolTimelineKey(slot.toolCall),
        toolCall: slot.toolCall,
        liveOutput: input.liveOutputFor(slot.toolCall.id),
      });
      input.consumeTool(slot.toolCall.id);
      continue;
    }

    const block = blocks[slot.blockIndex];
    if (block.kind !== "tool_call_draft") {
      if (!block.text && block.kind !== "thinking") continue;
      items.push({
        kind: "message",
        key: liveBlockKey(
          message.liveMessageId,
          block.kind,
          block.contentIndex,
        ),
        item: {
          id: liveBlockKey(
            message.liveMessageId,
            block.kind,
            block.contentIndex,
          ),
          role: "assistant",
          displayKind: block.kind === "thinking" ? "thinking" : "message",
          text: block.text,
          createdAt: message.startedAt,
          contentIndex: block.contentIndex,
          turnId: turn.turnId,
          messageOrdinal: message.messageOrdinal,
          live: !block.done,
          done: block.done,
          redacted: block.redacted,
        },
      });
      continue;
    }

    const slotKey = toolSlotKey(message.liveMessageId, block.contentIndex);
    // Coordinate-first joining keeps the retained materialized draft as one
    // handoff bridge; provider/source aliases are recovery-only fallbacks.
    const toolCall =
      input.context.toolCallsBySlot.get(slotKey) ??
      (block.providerToolCallId
        ? input.context.toolCallsByProviderId.get(block.providerToolCallId)
        : undefined);
    if (toolCall && input.isToolConsumed(toolCall.id)) continue;
    items.push({
      kind: "tool",
      key: slotKey,
      draft: {
        key: slotKey,
        runId: activeRun.runId,
        conversationId: activeRun.conversationId,
        turnId: turn.turnId,
        liveMessageId: message.liveMessageId,
        messageOrdinal: message.messageOrdinal,
        startedAt: message.startedAt,
        block,
      },
      toolCall,
      liveOutput: toolCall ? input.liveOutputFor(toolCall.id) : undefined,
    });
    if (toolCall) input.consumeTool(toolCall.id);
  }
}

/**
 * Merge persisted branch entries, streaming assistant content, and unified
 * tool activities into one renderer-facing conversation timeline. Thin compose
 * over {@link buildCommittedTimeline} + {@link buildActiveRunTimeline}; the
 * reactive UI calls those directly so the committed pass stays memoized.
 */
export function buildConversationTimeline(
  transcript: TranscriptItem[],
  toolCalls: ToolCallTranscriptRecord[],
  activeRun?: ConversationActiveRunSnapshot,
  transient?: ConversationTransientState,
): TimelineItem[] {
  const committed = buildCommittedTimeline(transcript, toolCalls, {
    includeUnanchoredTerminalToolCalls: !activeRun,
  });
  const liveItems = buildActiveRunTimeline(
    activeRun,
    transient,
    committed.context,
  );
  return [
    ...selectVisibleCommitted(
      committed.items,
      activeRun,
      transient,
      committed.context,
    ),
    ...liveItems,
  ];
}
