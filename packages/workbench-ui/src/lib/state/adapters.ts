/* eslint-disable max-lines -- Shared reducer covers the full live conversation event surface. */
import {
  assertTransition,
  conversationEventTypes,
  type ConversationActiveRunSnapshot,
  ConversationCompactedData,
  ConversationCompactionFailedData,
  ConversationCompactionStartedData,
  ConversationEntry,
  ConversationEntryAppendedData,
  ConversationEventType,
  ConversationLiveContentDeltaData,
  ConversationLiveContentDoneData,
  ConversationLiveMessageStartedData,
  ConversationLiveTurnStartedData,
  ConversationLiveToolDraftDeltaData,
  ConversationLiveToolDraftDiscardedData,
  ConversationLiveToolDraftDoneData,
  ConversationLiveToolDraftProgressData,
  ConversationLiveToolDraftStartedData,
  ConversationLiveToolOutputDeltaData,
  ConversationLiveToolOutputSnapshot,
  ConversationPromptCancelledData,
  ConversationPromptDequeuedData,
  ConversationPromptQueuedData,
  ConversationRunCancelledData,
  ConversationRunCompletedData,
  ConversationRunFailedData,
  ConversationRunResumedData,
  ConversationRunRetryingData,
  ConversationRunStartedData,
  ConversationRunSuspendedData,
  ConversationSnapshot,
  ConversationToolCallUpdatedData,
  EventEnvelope,
  QueuedPromptRecord,
  SandboxConversationViewSnapshot,
  ToolCallTranscriptRecord,
  toolCallTransitions,
} from "@nervekit/contracts";
import {
  drainMaterializedActiveRunMessages,
  materializedLiveMessagesFromEntries,
} from "./active-run.js";
import type {
  CompactionNotice,
  ConversationTransientState,
} from "./transcript-types.js";
import {
  type ConversationRenderState,
  emptyConversationRenderState,
} from "./types.js";

export const MAX_LIVE_TOOL_OUTPUT_CHARS = 32_000;
export const MAX_LIVE_TOOL_OUTPUT_CHUNKS = 400;

const conversationEventTypeSet = new Set<string>(conversationEventTypes);

export type ApplyConversationEventOptions = {
  onGap?: (reason: {
    conversationId?: string;
    runId?: string;
    type: string;
  }) => void;
  /** Advance the stream cursor for catalog events with no render projection. */
  consumeUnhandled?: boolean;
};

export function fromConversationSnapshot(
  snapshot: ConversationSnapshot,
): ConversationRenderState {
  return {
    conversationId: snapshot.conversation.id,
    snapshot,
    entries: snapshot.entries,
    activeEntryIds: snapshot.activeEntryIds,
    toolCalls: snapshot.toolCalls,
    activeRun: drainedSnapshotActiveRun(snapshot.activeRun, snapshot.entries),
    queuedPrompts: snapshot.activeRun?.queuedPrompts ?? [],
    contextUsage: snapshot.contextUsage,
    cursorSeq: snapshot.cursorSeq,
    generatedAt: snapshot.generatedAt,
    sending: Boolean(
      snapshot.activeRun &&
      ["running", "retrying", "aborting"].includes(snapshot.activeRun.status),
    ),
  };
}

/**
 * Defensive snapshot normalization: a snapshot taken between entry persistence
 * and materialization marking can still carry stale prose. Draining against
 * the snapshot entries removes persisted text/thinking while retaining an
 * unresolved tool slot through the durable-record handoff.
 */
function drainedSnapshotActiveRun(
  activeRun: ConversationActiveRunSnapshot | undefined,
  entries: ConversationEntry[],
): ConversationActiveRunSnapshot | undefined {
  if (!activeRun) return undefined;
  const cloned = cloneActiveRun(activeRun) as ConversationActiveRunSnapshot;
  drainMaterializedActiveRunMessages(
    cloned,
    materializedLiveMessagesFromEntries(entries),
  );
  return cloned;
}

export function fromSandboxConversationViewSnapshot(
  view: SandboxConversationViewSnapshot,
): ConversationRenderState {
  if (view.snapshot) {
    return {
      ...fromConversationSnapshot(view.snapshot),
      stale: view.stale,
      readOnly: view.fallback?.readOnly,
      fallbackReason: view.fallback?.reason,
    };
  }
  return {
    ...emptyConversationRenderState(view.conversationId),
    stale: view.stale,
    readOnly: view.fallback?.readOnly ?? true,
    fallbackReason: view.fallback?.reason,
    generatedAt: view.generatedAt,
    cursorSeq: view.lastEventSeq ?? 0,
    sending: false,
  };
}

export function applyConversationEvent(
  state: ConversationRenderState,
  event: EventEnvelope,
  options: ApplyConversationEventOptions = {},
): ConversationRenderState {
  const handled = conversationEventTypeSet.has(event.type);
  if (!handled && !options.consumeUnhandled) return state;
  if (event.seq <= state.cursorSeq) return state;
  if (event.seq !== state.cursorSeq + 1) {
    reportGap(
      options,
      event.data as { conversationId?: string; runId?: string },
      event.type,
    );
    return state;
  }

  const next = cloneRenderState(state);
  next.cursorSeq = event.seq;
  if (!handled) return next;

  const type = event.type as ConversationEventType;
  switch (type) {
    case "run.started":
      applyRunStarted(next, event.data as ConversationRunStartedData);
      break;
    case "conversation.entry.appended":
      applyEntryAppended(next, event.data as ConversationEntryAppendedData);
      break;
    case "conversation.context.updated":
      next.contextUsage = (
        event.data as { contextUsage: typeof next.contextUsage }
      ).contextUsage;
      break;
    case "conversation.prompt.queued":
      applyPromptQueued(next, event.data as ConversationPromptQueuedData);
      break;
    case "conversation.prompt.dequeued":
      applyPromptRemoved(next, event.data as ConversationPromptDequeuedData);
      break;
    case "conversation.prompt.cancelled":
      applyPromptRemoved(next, event.data as ConversationPromptCancelledData);
      break;
    case "toolCall.updated":
      applyToolCallUpdated(next, event.data as ConversationToolCallUpdatedData);
      break;
    case "run.resumed":
      applyRunResumed(next, event.data as ConversationRunResumedData);
      break;
    case "run.retrying":
      applyRunRetrying(next, event.data as ConversationRunRetryingData);
      break;
    case "run.suspended":
      applyRunSuspended(next, event.data as ConversationRunSuspendedData);
      break;
    case "run.completed":
      applyRunCompleted(next, event.data as ConversationRunCompletedData);
      break;
    case "run.cancelled":
      applyRunCancelled(next, event.data as ConversationRunCancelledData);
      break;
    case "run.failed":
      applyRunFailed(next, event.data as ConversationRunFailedData);
      break;
    case "conversation.compaction.started":
      applyCompactionStarted(
        next,
        event.data as ConversationCompactionStartedData,
        event.ts,
      );
      break;
    case "conversation.compaction.failed":
      applyCompactionFailed(
        next,
        event.data as ConversationCompactionFailedData,
        event.ts,
      );
      break;
    case "conversation.compacted":
      applyCompacted(next, event.data as ConversationCompactedData);
      break;
    case "conversation.live.turn.started":
      applyLiveTurnStarted(
        next,
        event.data as ConversationLiveTurnStartedData,
        event.ts,
      );
      break;
    case "conversation.live.message.started":
      applyLiveMessageStarted(
        next,
        event.data as ConversationLiveMessageStartedData,
      );
      break;
    case "conversation.live.content.delta":
      applyLiveContentDelta(
        next,
        event.data as ConversationLiveContentDeltaData,
        event.ts,
        options,
      );
      break;
    case "conversation.live.content.done":
      applyLiveContentDone(
        next,
        event.data as ConversationLiveContentDoneData,
        event.ts,
      );
      break;
    case "conversation.live.tool_draft.started":
      applyToolDraftStarted(
        next,
        event.data as ConversationLiveToolDraftStartedData,
        event.ts,
      );
      break;
    case "conversation.live.tool_draft.delta":
      applyToolDraftDelta(
        next,
        event.data as ConversationLiveToolDraftDeltaData,
        event.ts,
        options,
      );
      break;
    case "conversation.live.tool_draft.done":
      applyToolDraftDone(
        next,
        event.data as ConversationLiveToolDraftDoneData,
        event.ts,
      );
      break;
    case "conversation.live.tool_draft.progress":
      applyToolDraftProgress(
        next,
        event.data as ConversationLiveToolDraftProgressData,
        event.ts,
      );
      break;
    case "conversation.live.tool_draft.discarded":
      applyToolDraftDiscarded(
        next,
        event.data as ConversationLiveToolDraftDiscardedData,
      );
      break;
    case "conversation.live.tool_output.delta":
      applyToolOutputDelta(
        next,
        event.data as ConversationLiveToolOutputDeltaData,
        event.ts,
        options,
      );
      break;
  }
  return next;
}

/**
 * Shallow clone plus a deep clone of the mutable active-run tail. Handlers
 * replace `entries`/`toolCalls`/`activeEntryIds`/`queuedPrompts` immutably, so
 * those arrays keep their identity across unrelated events — the committed
 * timeline memoization depends on that.
 */
function cloneRenderState(
  state: ConversationRenderState,
): ConversationRenderState {
  return {
    ...state,
    activeRun: cloneActiveRun(state.activeRun),
    transient: cloneTransient(state.transient),
  };
}

function cloneActiveRun(
  run: ConversationActiveRunSnapshot | undefined,
): ConversationActiveRunSnapshot | undefined {
  if (!run) return undefined;
  return {
    ...run,
    retry: run.retry ? { ...run.retry } : undefined,
    recovery: run.recovery ? { ...run.recovery } : undefined,
    queuedPrompts: [...run.queuedPrompts],
    turns: run.turns.map((turn) => ({
      ...turn,
      messages: turn.messages.map((message) => ({
        ...message,
        blocks: message.blocks.map((block) =>
          block.kind === "tool_call_draft"
            ? {
                ...block,
                args: block.args ? { ...block.args } : undefined,
                progress: block.progress ? { ...block.progress } : undefined,
              }
            : { ...block },
        ),
      })),
    })),
    toolOutputsByToolCallId: Object.fromEntries(
      Object.entries(run.toolOutputsByToolCallId).map(([id, output]) => [
        id,
        cloneLiveOutput(output),
      ]),
    ),
  };
}

function cloneTransient(
  transient: ConversationTransientState | undefined,
): ConversationTransientState | undefined {
  if (!transient) return undefined;
  return {
    compaction: transient.compaction ? { ...transient.compaction } : undefined,
  };
}

function cloneLiveOutput(
  output: ConversationLiveToolOutputSnapshot,
): ConversationLiveToolOutputSnapshot {
  return {
    ...output,
    chunks: output.chunks.map((chunk) => ({ ...chunk })),
    outputLimits: output.outputLimits ? { ...output.outputLimits } : undefined,
  };
}

function applyRunStarted(
  state: ConversationRenderState,
  data: ConversationRunStartedData,
): void {
  state.conversationId = data.conversationId;
  state.activeRun = {
    runId: data.runId,
    agentId: data.agentId,
    projectId: data.projectId,
    conversationId: data.conversationId,
    status: "running",
    startedAt: data.startedAt,
    turns: [],
    toolOutputsByToolCallId: {},
    queuedPrompts: [],
  };
  clearTransientCompaction(state);
  state.queuedPrompts = [];
  state.sending = true;
  state.error = undefined;
}

function applyEntryAppended(
  state: ConversationRenderState,
  data: ConversationEntryAppendedData,
): void {
  const entry = data.entry;
  state.conversationId = data.conversationId ?? entry.conversationId;
  state.entries = upsert(state.entries, entry.id, entry);
  state.activeEntryIds = nextActiveEntryIds(state.activeEntryIds, entry);
  if (!state.activeRun || entry.role !== "assistant") return;
  const liveMessageId = data.liveMessageId ?? entry.liveMessageId;
  drainMaterializedActiveRunMessages(
    state.activeRun,
    materializedLiveMessagesFromEntries([
      liveMessageId && !entry.liveMessageId
        ? { ...entry, liveMessageId }
        : entry,
    ]),
  );
}

function nextActiveEntryIds(
  activeEntryIds: string[],
  entry: ConversationEntry,
): string[] {
  const existingIndex = activeEntryIds.indexOf(entry.id);
  if (existingIndex !== -1) return activeEntryIds.slice(0, existingIndex + 1);

  if (entry.parentEntryId) {
    const parentIndex = activeEntryIds.indexOf(entry.parentEntryId);
    if (parentIndex !== -1) {
      return [...activeEntryIds.slice(0, parentIndex + 1), entry.id];
    }
  }

  return [...activeEntryIds, entry.id];
}

function applyPromptQueued(
  state: ConversationRenderState,
  data: ConversationPromptQueuedData,
): void {
  state.queuedPrompts = upsertPrompt(
    state.queuedPrompts ?? [],
    data.queuedPrompt,
  );
  if (state.activeRun && runMatches(state.activeRun.runId, data.runId)) {
    state.activeRun.queuedPrompts = upsertPrompt(
      state.activeRun.queuedPrompts,
      data.queuedPrompt,
    );
  }
}

function applyPromptRemoved(
  state: ConversationRenderState,
  data: ConversationPromptDequeuedData | ConversationPromptCancelledData,
): void {
  state.queuedPrompts = removePrompt(
    state.queuedPrompts ?? [],
    data.queuedPrompt,
  );
  if (state.activeRun && runMatches(state.activeRun.runId, data.runId)) {
    state.activeRun.queuedPrompts = removePrompt(
      state.activeRun.queuedPrompts,
      data.queuedPrompt,
    );
  }
}

function upsertPrompt(
  prompts: QueuedPromptRecord[],
  prompt: QueuedPromptRecord | undefined,
): QueuedPromptRecord[] {
  if (!prompt) return prompts;
  return upsert(prompts, prompt.id, prompt);
}

function removePrompt(
  prompts: QueuedPromptRecord[],
  prompt: QueuedPromptRecord | undefined,
): QueuedPromptRecord[] {
  if (!prompt) return prompts;
  return prompts.filter((candidate) => candidate.id !== prompt.id);
}

/**
 * Upsert the durable tool record. Draft blocks are intentionally kept: the
 * unified timeline node joins the draft with the actual record during the
 * presentation handoff. A discarded draft is removed immediately; a
 * materialized message retains its draft slot until the active run ends.
 */
function applyToolCallUpdated(
  state: ConversationRenderState,
  data: ConversationToolCallUpdatedData,
): void {
  const toolCall = data.toolCall;
  const existing = state.toolCalls.find(
    (candidate) => candidate.id === toolCall.id,
  );
  if (existing && existing.status !== toolCall.status) {
    assertTransition(
      toolCallTransitions,
      existing.status,
      toolCall.status,
      `conversation reducer tool call ${toolCall.id}`,
    );
  }
  if (toolCall.hidden) {
    state.toolCalls = state.toolCalls.filter(
      (candidate) => candidate.id !== toolCall.id,
    );
  } else {
    state.toolCalls = upsertToolCallUpdate(state.toolCalls, toolCall);
  }
}

function applyRunResumed(
  state: ConversationRenderState,
  data: ConversationRunResumedData,
): void {
  state.conversationId = data.conversationId;
  const activeRun = ensureActiveRun(state, {
    ...data,
    startedAt: data.resumedAt,
  });
  activeRun.status = "running";
  activeRun.retry = undefined;
  activeRun.recovery = undefined;
  state.sending = true;
  state.error = undefined;
}

function applyRunRetrying(
  state: ConversationRenderState,
  data: ConversationRunRetryingData,
): void {
  const activeRun = ensureActiveRun(state, {
    conversationId: data.conversationId,
    agentId: data.agentId,
    projectId: data.projectId,
    runId: data.runId,
    startedAt: data.retryAt,
  });
  activeRun.status = "retrying";
  activeRun.recovery = undefined;
  activeRun.retry = {
    attempt: data.attempt,
    maxRetries: data.maxRetries,
    delayMs: data.delayMs,
    retryAt: data.retryAt,
    errorMessage: data.errorMessage,
    failedEntryId: data.failedEntryId,
  };
  state.sending = true;
  state.error = undefined;
}

function applyRunSuspended(
  state: ConversationRenderState,
  data: ConversationRunSuspendedData,
): void {
  if (runMatches(state.activeRun?.runId, data.runId))
    state.activeRun = undefined;
  state.sending = false;
}

function applyRunCompleted(
  state: ConversationRenderState,
  data: ConversationRunCompletedData,
): void {
  if (runMatches(state.activeRun?.runId, data.runId))
    state.activeRun = undefined;
  state.queuedPrompts = [];
  state.sending = false;
  state.error = undefined;
}

function applyRunCancelled(
  state: ConversationRenderState,
  data: ConversationRunCancelledData,
): void {
  if (runMatches(state.activeRun?.runId, data.runId))
    state.activeRun = undefined;
  state.queuedPrompts = [];
  state.sending = false;
  state.error = undefined;
}

function applyRunFailed(
  state: ConversationRenderState,
  data: ConversationRunFailedData,
): void {
  const continuableInterruption =
    data.interrupted === true && data.continuable === true;
  const targetsCurrentRun =
    !state.activeRun || runMatches(state.activeRun.runId, data.runId);
  if (continuableInterruption && targetsCurrentRun) {
    const activeRun = ensureActiveRun(state, {
      conversationId: data.conversationId,
      agentId: data.agentId,
      projectId: data.projectId,
      runId: data.runId,
      startedAt: data.failedAt,
    });
    activeRun.status = "interrupted";
    activeRun.retry = undefined;
    activeRun.recovery = {
      errorMessage: data.message || undefined,
      continuable: true,
    };
    activeRun.queuedPrompts = [];
  } else if (runMatches(state.activeRun?.runId, data.runId)) {
    state.activeRun = undefined;
  }
  // A failed compaction notice explains the failure; keep it visible.
  if (state.transient?.compaction?.state !== "failed") {
    clearTransientCompaction(state);
  }
  state.queuedPrompts = [];
  state.sending = false;
  state.error =
    data.aborted || (continuableInterruption && targetsCurrentRun)
      ? undefined
      : data.message || "Agent error";
}

function applyCompactionStarted(
  state: ConversationRenderState,
  data: ConversationCompactionStartedData,
  ts: string,
): void {
  const transient = ensureTransient(state);
  transient.compaction = compactionNoticeFromStarted(
    data,
    ts,
    transient.compaction,
  );
  state.error = undefined;
}

function applyCompactionFailed(
  state: ConversationRenderState,
  data: ConversationCompactionFailedData,
  ts: string,
): void {
  const transient = ensureTransient(state);
  transient.compaction = compactionNoticeFromFailed(
    data,
    ts,
    transient.compaction,
  );
}

function applyCompacted(
  state: ConversationRenderState,
  data: ConversationCompactedData,
): void {
  state.entries = upsert(state.entries, data.entry.id, data.entry);
  state.activeEntryIds = nextActiveEntryIds(state.activeEntryIds, data.entry);
  clearTransientCompaction(state);
}

function compactionNoticeFromStarted(
  data: ConversationCompactionStartedData,
  ts: string,
  current?: CompactionNotice,
): CompactionNotice {
  const id =
    current?.id ??
    liveCompactionId(data.conversationId, data.runId, data.reason);
  return {
    id,
    state: "running",
    reason: data.reason,
    conversationId: data.conversationId,
    agentId: data.agentId,
    runId: data.runId,
    contextWindow: data.contextWindow,
    contextTokens: data.contextTokens,
    thresholdTokens: data.thresholdTokens,
    triggerReserveTokens: data.triggerReserveTokens,
    keepRecentTokens: data.keepRecentTokens,
    failedEntryId: data.failedEntryId,
    createdAt: data.startedAt ?? ts,
  };
}

function compactionNoticeFromFailed(
  data: ConversationCompactionFailedData,
  ts: string,
  current?: CompactionNotice,
): CompactionNotice {
  return {
    id:
      current?.id ??
      liveCompactionId(data.conversationId, data.runId, data.reason),
    state: "failed",
    reason: data.reason,
    conversationId: data.conversationId,
    agentId: data.agentId,
    runId: data.runId,
    contextWindow: current?.contextWindow,
    contextTokens: current?.contextTokens,
    thresholdTokens: current?.thresholdTokens,
    triggerReserveTokens: current?.triggerReserveTokens,
    keepRecentTokens: current?.keepRecentTokens,
    failedEntryId: data.failedEntryId ?? current?.failedEntryId,
    errorMessage: data.message,
    createdAt: current?.createdAt ?? ts,
    completedAt: data.failedAt,
  };
}

function liveCompactionId(
  conversationId: string,
  runId: string | undefined,
  reason: string,
): string {
  return `live:compaction:${runId ?? conversationId}:${reason}`;
}

function ensureTransient(
  state: ConversationRenderState,
): ConversationTransientState {
  state.transient ??= {};
  return state.transient;
}

function clearTransientCompaction(state: ConversationRenderState): void {
  if (!state.transient?.compaction) return;
  state.transient = { ...state.transient, compaction: undefined };
}

function applyLiveTurnStarted(
  state: ConversationRenderState,
  data: ConversationLiveTurnStartedData,
  ts: string,
): void {
  const run = ensureActiveRun(state, { ...data, startedAt: ts });
  ensureActiveTurn(run, data.turnId, data.ordinal);
  run.status = "running";
  run.retry = undefined;
  state.sending = true;
}

function applyLiveMessageStarted(
  state: ConversationRenderState,
  data: ConversationLiveMessageStartedData,
): void {
  ensureActiveMessage(state, data, data.startedAt);
  // Streaming resumed; a pending retry attempt has evidently succeeded.
  if (state.activeRun && state.activeRun.status === "retrying") {
    state.activeRun.status = "running";
    state.activeRun.retry = undefined;
  }
  state.sending = true;
}

function applyLiveContentDelta(
  state: ConversationRenderState,
  data: ConversationLiveContentDeltaData,
  ts: string,
  options: ApplyConversationEventOptions,
): void {
  if (!data.delta) return;
  const current = findActiveBlock(state, data);
  const currentLength =
    current && current.kind !== "tool_call_draft" ? current.text.length : 0;
  if (currentLength > data.offset) return;
  if (currentLength < data.offset) {
    reportGap(options, data, "conversation.live.content.delta");
    return;
  }
  const block = ensureActiveTextBlock(state, data, ts);
  if (block) block.text = `${block.text}${data.delta}`;
  state.sending = true;
}

function applyLiveContentDone(
  state: ConversationRenderState,
  data: ConversationLiveContentDoneData,
  ts: string,
): void {
  const block = ensureActiveTextBlock(state, data, ts);
  if (!block) return;
  block.text = data.finalText ?? block.text;
  block.done = true;
  block.redacted = data.kind === "thinking" ? data.redacted : undefined;
}

function applyToolDraftStarted(
  state: ConversationRenderState,
  data: ConversationLiveToolDraftStartedData,
  ts: string,
): void {
  ensureActiveToolDraftBlock(state, data, ts);
  state.sending = true;
}

function applyToolDraftDelta(
  state: ConversationRenderState,
  data: ConversationLiveToolDraftDeltaData,
  ts: string,
  options: ApplyConversationEventOptions,
): void {
  const current = findActiveBlock(state, data);
  const currentLength =
    current?.kind === "tool_call_draft" ? current.argsText.length : 0;
  if (currentLength > data.offset) return;
  if (currentLength < data.offset) {
    reportGap(options, data, "conversation.live.tool_draft.delta");
    return;
  }
  const block = ensureActiveToolDraftBlock(state, data, ts);
  if (block) block.argsText = `${block.argsText}${data.delta}`;
}

function applyToolDraftDone(
  state: ConversationRenderState,
  data: ConversationLiveToolDraftDoneData,
  ts: string,
): void {
  const block = ensureActiveToolDraftBlock(state, data, ts);
  if (!block) return;
  block.argsText = "";
  block.args = data.args;
  block.done = true;
  block.providerToolCallId = data.providerToolCallId;
  block.toolName = data.toolName;
}

function applyToolDraftProgress(
  state: ConversationRenderState,
  data: ConversationLiveToolDraftProgressData,
  ts: string,
): void {
  const block = ensureActiveToolDraftBlock(state, data, ts);
  if (block) block.progress = data.progress;
}

function applyToolDraftDiscarded(
  state: ConversationRenderState,
  data: ConversationLiveToolDraftDiscardedData,
): void {
  const message = activeMessage(state, data.turnId, data.liveMessageId);
  if (!message) return;
  message.blocks = message.blocks.filter((block) => {
    if (block.kind !== "tool_call_draft") return true;
    if (block.contentIndex === data.contentIndex) return false;
    if (
      data.providerToolCallId &&
      block.providerToolCallId === data.providerToolCallId
    )
      return false;
    return true;
  });
}

function applyToolOutputDelta(
  state: ConversationRenderState,
  data: ConversationLiveToolOutputDeltaData,
  ts: string,
  options: ApplyConversationEventOptions,
): void {
  if (!data.delta) return;
  const activeRun =
    state.activeRun ??
    (data.runId
      ? ensureActiveRun(state, {
          conversationId: data.conversationId,
          agentId: data.agentId,
          projectId: data.projectId,
          runId: data.runId,
          startedAt: ts,
        })
      : undefined);
  if (!activeRun) return;
  const previous = activeRun.toolOutputsByToolCallId[data.toolCallId];
  const previousTotal =
    previous?.outputLimits?.totalChars ?? previous?.text.length ?? 0;
  if (previousTotal > data.offset) return;
  if (previousTotal < data.offset) {
    reportGap(options, data, "conversation.live.tool_output.delta");
    return;
  }
  activeRun.toolOutputsByToolCallId = {
    ...activeRun.toolOutputsByToolCallId,
    [data.toolCallId]: capLiveOutput({
      toolCallId: data.toolCallId,
      chunks: [
        ...(previous?.chunks ?? []),
        { stream: data.stream, text: data.delta, ts },
      ],
      text: `${previous?.text ?? ""}${data.delta}`,
      updatedAt: ts,
      outputLimits: {
        capped: false,
        direction: "tail",
        maxChars: MAX_LIVE_TOOL_OUTPUT_CHARS,
        maxChunks: MAX_LIVE_TOOL_OUTPUT_CHUNKS,
        totalChars: previousTotal + data.delta.length,
      },
    }),
  };
}

function ensureActiveRun(
  state: ConversationRenderState,
  data: {
    conversationId: string;
    agentId: string;
    projectId: string;
    runId: string;
    startedAt?: string;
  },
): ConversationActiveRunSnapshot {
  if (state.activeRun?.runId === data.runId) return state.activeRun;
  state.activeRun = {
    runId: data.runId,
    agentId: data.agentId,
    projectId: data.projectId,
    conversationId: data.conversationId,
    status: "running",
    startedAt: data.startedAt ?? new Date().toISOString(),
    turns: [],
    toolOutputsByToolCallId: {},
    queuedPrompts: state.queuedPrompts ?? [],
  };
  return state.activeRun;
}

function ensureActiveTurn(
  run: ConversationActiveRunSnapshot,
  turnId: string,
  ordinal = run.turns.length,
) {
  let turn = run.turns.find((item) => item.turnId === turnId);
  if (!turn) {
    turn = { turnId, ordinal, messages: [] };
    run.turns.push(turn);
  }
  return turn;
}

function ensureActiveMessage(
  state: ConversationRenderState,
  data: {
    conversationId: string;
    agentId: string;
    projectId: string;
    runId: string;
    turnId: string;
    liveMessageId: string;
    messageOrdinal?: number;
  },
  startedAt: string,
) {
  const run = ensureActiveRun(state, { ...data, startedAt });
  const turn = ensureActiveTurn(run, data.turnId);
  let message = turn.messages.find(
    (item) => item.liveMessageId === data.liveMessageId,
  );
  if (!message) {
    message = {
      liveMessageId: data.liveMessageId,
      messageOrdinal: data.messageOrdinal ?? turn.messages.length,
      startedAt,
      blocks: [],
    };
    turn.messages.push(message);
  }
  return message;
}

function findActiveBlock(
  state: ConversationRenderState,
  data: { turnId: string; liveMessageId: string; contentBlockId: string },
) {
  return activeMessage(state, data.turnId, data.liveMessageId)?.blocks.find(
    (block) => block.contentBlockId === data.contentBlockId,
  );
}

function ensureActiveTextBlock(
  state: ConversationRenderState,
  data: ConversationLiveContentDeltaData | ConversationLiveContentDoneData,
  ts: string,
) {
  const message = ensureActiveMessage(
    state,
    data,
    activeMessageStartedAt(state, data) ?? ts,
  );
  let block = message.blocks.find(
    (item) => item.contentBlockId === data.contentBlockId,
  );
  if (!block || block.kind === "tool_call_draft") {
    block = {
      kind: data.kind,
      contentBlockId: data.contentBlockId,
      contentIndex: data.contentIndex,
      text: "",
      done: false,
    };
    message.blocks.push(block);
  }
  return block;
}

function ensureActiveToolDraftBlock(
  state: ConversationRenderState,
  data:
    | ConversationLiveToolDraftStartedData
    | ConversationLiveToolDraftDeltaData
    | ConversationLiveToolDraftDoneData
    | ConversationLiveToolDraftProgressData,
  ts: string,
) {
  const message = ensureActiveMessage(
    state,
    data,
    activeMessageStartedAt(state, data) ?? ts,
  );
  let block = message.blocks.find(
    (item) => item.contentBlockId === data.contentBlockId,
  );
  if (block?.kind !== "tool_call_draft") {
    block = {
      kind: "tool_call_draft",
      contentBlockId: data.contentBlockId,
      contentIndex: data.contentIndex,
      argsText: "",
      done: false,
    };
    message.blocks.push(block);
  }
  block.providerToolCallId =
    data.providerToolCallId ?? block.providerToolCallId;
  block.toolName = data.toolName ?? block.toolName;
  return block;
}

function activeMessage(
  state: ConversationRenderState,
  turnId: string,
  liveMessageId: string,
) {
  return state.activeRun?.turns
    .find((turn) => turn.turnId === turnId)
    ?.messages.find((message) => message.liveMessageId === liveMessageId);
}

function activeMessageStartedAt(
  state: ConversationRenderState,
  data: { turnId: string; liveMessageId: string },
): string | undefined {
  return activeMessage(state, data.turnId, data.liveMessageId)?.startedAt;
}

export function capLiveOutput(
  output: ConversationLiveToolOutputSnapshot,
): ConversationLiveToolOutputSnapshot {
  const totalChars = output.outputLimits?.totalChars ?? output.text.length;
  let text = output.text;
  if (text.length > MAX_LIVE_TOOL_OUTPUT_CHARS) {
    text = text.slice(text.length - MAX_LIVE_TOOL_OUTPUT_CHARS);
  }
  const chunks =
    output.chunks.length > MAX_LIVE_TOOL_OUTPUT_CHUNKS
      ? output.chunks.slice(output.chunks.length - MAX_LIVE_TOOL_OUTPUT_CHUNKS)
      : output.chunks;
  const capped =
    totalChars > text.length ||
    output.chunks.length > MAX_LIVE_TOOL_OUTPUT_CHUNKS;
  return {
    ...output,
    text,
    chunks,
    outputLimits: {
      capped,
      direction: "tail",
      maxChars: MAX_LIVE_TOOL_OUTPUT_CHARS,
      maxChunks: MAX_LIVE_TOOL_OUTPUT_CHUNKS,
      totalChars,
      displayedChars: text.length,
      omittedChars: Math.max(0, totalChars - text.length),
      displayedLines: countLines(text),
      totalLines: capped ? undefined : countLines(text),
      omittedLines: undefined,
    },
  };
}

function countLines(text: string): number {
  if (!text) return 0;
  return text.split("\n").length;
}

function runMatches(
  currentRunId: string | undefined,
  runId: string | undefined,
): boolean {
  return Boolean(currentRunId && runId && currentRunId === runId);
}

function reportGap(
  options: ApplyConversationEventOptions,
  data: { conversationId?: string; runId?: string },
  type: string,
): void {
  options.onGap?.({
    conversationId: data.conversationId,
    runId: data.runId,
    type,
  });
}

function upsertToolCallUpdate(
  items: ToolCallTranscriptRecord[],
  update: ToolCallTranscriptRecord,
): ToolCallTranscriptRecord[] {
  const existing = items.find((candidate) => candidate.id === update.id);
  const merged: ToolCallTranscriptRecord = existing
    ? {
        ...existing,
        ...update,
        argsPreview:
          update.argsPreview === undefined
            ? existing.argsPreview
            : update.argsPreview,
        resultPreview:
          update.resultPreview === undefined
            ? existing.resultPreview
            : update.resultPreview,
        previewOverflow:
          update.previewOverflow === undefined
            ? existing.previewOverflow
            : update.previewOverflow,
        turnId: update.turnId === undefined ? existing.turnId : update.turnId,
        liveMessageId:
          update.liveMessageId === undefined
            ? existing.liveMessageId
            : update.liveMessageId,
        contentIndex:
          update.contentIndex === undefined
            ? existing.contentIndex
            : update.contentIndex,
      }
    : update;
  return upsert(items, update.id, merged);
}

function upsert<T extends { id: string }>(
  items: T[],
  id: string,
  item: T,
): T[] {
  const index = items.findIndex((candidate) => candidate.id === id);
  if (index === -1) return [...items, item];
  const next = [...items];
  next[index] = item;
  return next;
}
