import {
  assertTransition,
  EventEnvelope,
  type NotifyEvent,
  toolCallTransitions,
} from "@nervekit/contracts/events";
import {
  conversationEventTypes,
  conversationLiveEventTypes,
  ConversationCompactionCancelledData,
  ConversationCompactionFailedData,
  ConversationCompactionProgressData,
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
  ConversationToolCallUpdatedData,
} from "@nervekit/contracts/conversations";
import { QueuedPromptRecord } from "@nervekit/contracts/agents";
import { ToolCallTranscriptRecord } from "@nervekit/contracts/tools";
import {
  drainMaterializedActiveRunMessages,
  materializedLiveMessagesFromEntries,
} from "./active-run.js";
import type { ConversationRenderState } from "./conversation-render-state.js";
import { ConversationCowDraft } from "./conversation-cow-draft.js";
import {
  type ApplyConversationEventOptions,
  reportGap,
} from "./conversation-event-policy.js";
import {
  applyCompactionStarted,
  applyCompactionProgress,
  applyCompactionFailed,
  applyCompactionCancelled,
  applyCompacted,
  clearTransientCompaction,
} from "./conversation-compaction-reducer.js";
import {
  applyLiveTurnStarted,
  applyLiveMessageStarted,
  applyLiveContentDelta,
  applyLiveContentDone,
  applyToolDraftStarted,
  applyToolDraftDelta,
  applyToolDraftDone,
  applyToolDraftProgress,
  applyToolDraftDiscarded,
  applyToolOutputDelta,
} from "./conversation-live-reducer.js";
import { ensureActiveRun, runMatches } from "./conversation-run-state.js";

const conversationEventTypeSet = new Set<string>(conversationEventTypes);

const conversationLiveEventTypeSet = new Set<string>(
  conversationLiveEventTypes,
);

function revisionFromEvent(data: unknown): number | undefined {
  if (!data || typeof data !== "object" || Array.isArray(data))
    return undefined;
  const revision = (data as { conversationRevision?: unknown })
    .conversationRevision;
  return typeof revision === "number" &&
    Number.isSafeInteger(revision) &&
    revision >= 0
    ? revision
    : undefined;
}

export function applyConversationNotification(
  state: ConversationRenderState,
  event: NotifyEvent,
  options: ApplyConversationEventOptions = {},
): ConversationRenderState {
  if (!conversationLiveEventTypeSet.has(event.type)) return state;
  const runId = (event.data as { runId?: string }).runId;
  if (!runId || state.activeRun?.runId !== runId) return state;
  // Ephemeral delivery can race with a newer snapshot, but it must not move
  // the durable aggregate watermark. Run identity and per-output offsets guard
  // current/future notifications after this stale check.
  const eventRevision = revisionFromEvent(event.data);
  if (
    eventRevision !== undefined &&
    state.conversationRevision !== undefined &&
    eventRevision < state.conversationRevision
  ) {
    return state;
  }
  const data =
    event.data && typeof event.data === "object" && !Array.isArray(event.data)
      ? { ...event.data, conversationRevision: undefined }
      : event.data;
  const applied = applyConversationEvent(
    state,
    { ...event, data, seq: state.cursorSeq + 1 },
    options,
  );
  return applied === state
    ? state
    : {
        ...applied,
        cursorSeq: state.cursorSeq,
        conversationRevision: state.conversationRevision,
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

  // Aggregate journal revisions include internal commits with no public event,
  // so forward jumps are expected. The dense public stream sequence above is
  // the sole event-gap detector; this revision is only a stale-state watermark.
  const eventRevision = revisionFromEvent(event.data);
  const currentRevision = state.conversationRevision;
  const next: ConversationRenderState = {
    ...state,
    cursorSeq: event.seq,
    conversationRevision:
      eventRevision === undefined
        ? currentRevision
        : Math.max(currentRevision ?? 0, eventRevision),
  };
  if (
    !handled ||
    (eventRevision !== undefined &&
      currentRevision !== undefined &&
      eventRevision < currentRevision)
  )
    return next;

  const draft = new ConversationCowDraft(next);
  const type = event.type as ConversationEventType;
  switch (type) {
    case "run.started":
      applyRunStarted(next, event.data as ConversationRunStartedData);
      break;
    case "conversation.entry.appended": {
      const data = event.data as ConversationEntryAppendedData;
      if (data.entry.role === "assistant") draft.ownAllRunMessages();
      applyEntryAppended(next, data);
      break;
    }
    case "conversation.context.updated":
      next.contextUsage = (
        event.data as { contextUsage: typeof next.contextUsage }
      ).contextUsage;
      break;
    case "conversation.prompt.queued":
      draft.ownRun();
      applyPromptQueued(next, event.data as ConversationPromptQueuedData);
      break;
    case "conversation.prompt.dequeued":
      draft.ownRun();
      applyPromptRemoved(next, event.data as ConversationPromptDequeuedData);
      break;
    case "conversation.prompt.cancelled":
      draft.ownRun();
      applyPromptRemoved(next, event.data as ConversationPromptCancelledData);
      break;
    case "toolCall.updated":
      applyToolCallUpdated(
        next,
        event.data as ConversationToolCallUpdatedData,
        options.retainHiddenToolCalls,
      );
      break;
    case "run.resumed":
      draft.ownRun();
      applyRunResumed(next, event.data as ConversationRunResumedData);
      break;
    case "run.retrying":
      draft.ownRun();
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
      draft.ownRun();
      applyRunFailed(next, event.data as ConversationRunFailedData);
      break;
    case "conversation.compaction.started":
      draft.ownTransient();
      applyCompactionStarted(
        next,
        event.data as ConversationCompactionStartedData,
        event.ts,
      );
      break;
    case "conversation.compaction.progress":
      draft.ownTransient();
      applyCompactionProgress(
        next,
        event.data as ConversationCompactionProgressData,
        event.ts,
      );
      break;
    case "conversation.compaction.failed":
      draft.ownTransient();
      applyCompactionFailed(
        next,
        event.data as ConversationCompactionFailedData,
        event.ts,
      );
      break;
    case "conversation.compaction.cancelled":
      draft.ownTransient();
      applyCompactionCancelled(
        next,
        event.data as ConversationCompactionCancelledData,
        event.ts,
      );
      break;
    case "conversation.compacted":
      applyCompacted(next);
      break;
    case "conversation.live.turn.started": {
      const data = event.data as ConversationLiveTurnStartedData;
      draft.ownTurn(data.turnId);
      applyLiveTurnStarted(next, data, event.ts);
      break;
    }
    case "conversation.live.message.started": {
      const data = event.data as ConversationLiveMessageStartedData;
      draft.ownMessage(data.turnId, data.liveMessageId);
      applyLiveMessageStarted(next, data);
      break;
    }
    case "conversation.live.content.delta":
      applyLiveContentDelta(
        next,
        event.data as ConversationLiveContentDeltaData,
        event.ts,
        options,
        draft,
      );
      break;
    case "conversation.live.content.done":
      applyLiveContentDone(
        next,
        event.data as ConversationLiveContentDoneData,
        event.ts,
        draft,
      );
      break;
    case "conversation.live.tool_draft.started":
      applyToolDraftStarted(
        next,
        event.data as ConversationLiveToolDraftStartedData,
        event.ts,
        draft,
      );
      break;
    case "conversation.live.tool_draft.delta":
      applyToolDraftDelta(
        next,
        event.data as ConversationLiveToolDraftDeltaData,
        event.ts,
        options,
        draft,
      );
      break;
    case "conversation.live.tool_draft.done":
      applyToolDraftDone(
        next,
        event.data as ConversationLiveToolDraftDoneData,
        event.ts,
        draft,
      );
      break;
    case "conversation.live.tool_draft.progress":
      applyToolDraftProgress(
        next,
        event.data as ConversationLiveToolDraftProgressData,
        event.ts,
        draft,
      );
      break;
    case "conversation.live.tool_draft.discarded": {
      const data = event.data as ConversationLiveToolDraftDiscardedData;
      draft.ownMessage(data.turnId, data.liveMessageId);
      applyToolDraftDiscarded(next, data);
      break;
    }
    case "conversation.live.tool_output.delta":
      applyToolOutputDelta(
        next,
        event.data as ConversationLiveToolOutputDeltaData,
        event.ts,
        options,
        draft,
      );
      break;
  }
  return next;
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
  retainHidden = false,
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
  if (toolCall.hidden && !retainHidden) {
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
  // Terminal compaction notices explain why no checkpoint was created.
  if (
    state.transient?.compaction?.state !== "failed" &&
    state.transient?.compaction?.state !== "cancelled"
  ) {
    clearTransientCompaction(state);
  }
  state.queuedPrompts = [];
  state.sending = false;
  state.error =
    data.aborted || (continuableInterruption && targetsCurrentRun)
      ? undefined
      : data.message || "Agent error";
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
