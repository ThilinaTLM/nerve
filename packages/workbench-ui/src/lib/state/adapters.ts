// biome-ignore lint/style/noExcessiveLinesPerFile: Shared reducer covers the full live conversation event surface.
import type {
  ConversationActiveRunSnapshot,
  ConversationCompactionFailedData,
  ConversationCompactionStartedData,
  ConversationEntry,
  ConversationEntryAppendedData,
  ConversationEventType,
  ConversationLiveContentDeltaData,
  ConversationLiveContentDoneData,
  ConversationLiveMessageStartedData,
  ConversationLiveToolDraftDeltaData,
  ConversationLiveToolDraftDiscardedData,
  ConversationLiveToolDraftDoneData,
  ConversationLiveToolDraftProgressData,
  ConversationLiveToolDraftStartedData,
  ConversationLiveToolOutputDeltaData,
  ConversationPromptCancelledData,
  ConversationPromptDequeuedData,
  ConversationPromptQueuedData,
  ConversationRunCompletedData,
  ConversationRunFailedData,
  ConversationRunRetryingData,
  ConversationRunStartedData,
  ConversationRunSuspendedData,
  ConversationSnapshot,
  ConversationToolCallUpdatedData,
  EventEnvelope,
  QueuedPromptRecord,
  SandboxConversationViewSnapshot,
  ToolCallTranscriptRecord,
} from "@nervekit/contracts";
import { activeRunToLegacyLive } from "./live.js";
import {
  type CompactionNotice,
  type ConversationLiveState,
  emptyLiveState,
  type LiveToolCallDraft,
  type LiveToolOutput,
  type TranscriptItem,
} from "./transcript-types.js";
import {
  type ConversationRenderState,
  emptyConversationRenderState,
} from "./types.js";

export const MAX_LIVE_TOOL_OUTPUT_CHARS = 32_000;
export const MAX_LIVE_TOOL_OUTPUT_CHUNKS = 400;

export type ApplyConversationEventOptions = {
  onGap?: (reason: {
    conversationId?: string;
    runId?: string;
    type: string;
  }) => void;
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
    activeRun: snapshot.activeRun,
    queuedPrompts: snapshot.activeRun?.queuedPrompts ?? [],
    contextUsage: snapshot.contextUsage,
    cursorSeq: snapshot.cursorSeq,
    generatedAt: snapshot.generatedAt,
    sending: Boolean(snapshot.activeRun),
  };
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
  if (!event.type.startsWith("conversation.")) return state;
  if (event.durability === "durable" && event.seq <= state.cursorSeq) {
    return state;
  }

  const next = cloneRenderState(state);
  if (event.durability === "durable") next.cursorSeq = event.seq;

  const type = event.type as ConversationEventType;
  switch (type) {
    case "conversation.run.started":
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
    case "conversation.tool_call.updated":
      applyToolCallUpdated(next, event.data as ConversationToolCallUpdatedData);
      break;
    case "conversation.run.retrying":
      applyRunRetrying(
        next,
        event.data as ConversationRunRetryingData,
        event.ts,
      );
      break;
    case "conversation.run.suspended":
      applyRunSuspended(next, event.data as ConversationRunSuspendedData);
      break;
    case "conversation.run.completed":
      applyRunCompleted(next, event.data as ConversationRunCompletedData);
      break;
    case "conversation.run.failed":
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

function cloneRenderState(
  state: ConversationRenderState,
): ConversationRenderState {
  return {
    ...state,
    entries: [...state.entries],
    activeEntryIds: [...state.activeEntryIds],
    toolCalls: [...state.toolCalls],
    activeRun: cloneActiveRun(state.activeRun),
    live: cloneLiveState(state.live),
    queuedPrompts: state.queuedPrompts ? [...state.queuedPrompts] : undefined,
  };
}

function cloneActiveRun(
  run: ConversationActiveRunSnapshot | undefined,
): ConversationActiveRunSnapshot | undefined {
  if (!run) return undefined;
  return {
    ...run,
    retry: run.retry ? { ...run.retry } : undefined,
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

function cloneLiveState(
  live: ConversationLiveState | undefined,
): ConversationLiveState | undefined {
  if (!live) return undefined;
  return {
    ...live,
    messages: live.messages.map((message) => ({ ...message })),
    toolDrafts: live.toolDrafts.map((draft) => ({
      ...draft,
      args: draft.args ? { ...draft.args } : undefined,
      progress: draft.progress ? { ...draft.progress } : undefined,
    })),
    toolOutputByToolCallId: Object.fromEntries(
      Object.entries(live.toolOutputByToolCallId).map(([id, output]) => [
        id,
        cloneLiveOutput(output),
      ]),
    ),
    runStatus: live.runStatus ? { ...live.runStatus } : undefined,
    compaction: live.compaction ? { ...live.compaction } : undefined,
    hiddenEntryIds: live.hiddenEntryIds ? [...live.hiddenEntryIds] : undefined,
  };
}

function cloneLiveOutput<T extends LiveToolOutput>(output: T): T {
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
  state.live = emptyLiveState(data.runId);
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
  const liveMessageId = data.liveMessageId ?? entry.liveMessageId;
  if (liveMessageId) removeLiveMessageById(state, liveMessageId);
  removeDuplicateLivePlaceholders(state, entry);
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

function removeLiveMessageById(
  state: ConversationRenderState,
  liveMessageId: string,
): void {
  const livePrefix = `live:${liveMessageId}:`;
  if (state.live) {
    state.live.messages = state.live.messages.filter(
      (item) => !item.id?.startsWith(livePrefix),
    );
    state.live.toolDrafts = state.live.toolDrafts.filter(
      (draft) => !draft.key.startsWith(livePrefix),
    );
  }
  if (state.activeRun) {
    for (const turn of state.activeRun.turns) {
      turn.messages = turn.messages.filter(
        (message) => message.liveMessageId !== liveMessageId,
      );
    }
  }
}

function removeDuplicateLivePlaceholders(
  state: ConversationRenderState,
  entry: ConversationEntry,
): void {
  if (!state.live || entry.role !== "assistant" || !entry.text.trim()) return;
  state.live.messages = state.live.messages.filter(
    (message) =>
      message.role !== "assistant" ||
      message.displayKind === "thinking" ||
      message.text.trim() !== entry.text.trim(),
  );
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

function applyToolCallUpdated(
  state: ConversationRenderState,
  data: ConversationToolCallUpdatedData,
): void {
  const toolCall = data.toolCall;
  if (toolCall.hidden) {
    state.toolCalls = state.toolCalls.filter(
      (candidate) => candidate.id !== toolCall.id,
    );
  } else {
    state.toolCalls = upsertToolCallUpdate(state.toolCalls, toolCall);
  }

  const providerToolCallIds = [
    data.providerToolCallId,
    toolCall.providerToolCallId,
    toolCall.sourceToolCallId,
  ].filter((value): value is string => Boolean(value));
  removeLiveDraftsForProviderIds(state, providerToolCallIds);
}

function applyRunRetrying(
  state: ConversationRenderState,
  data: ConversationRunRetryingData,
  ts: string,
): void {
  const live = ensureLiveState(state, data.runId);
  const retry = {
    attempt: data.attempt,
    maxRetries: data.maxRetries,
    delayMs: data.delayMs,
    retryAt: data.retryAt,
    errorMessage: data.errorMessage,
    failedEntryId: data.failedEntryId,
  };
  const notice = {
    conversationId: data.conversationId,
    agentId: data.agentId,
    runId: data.runId,
    state: "retrying" as const,
    createdAt: ts,
    ...retry,
  };
  live.runStatus = notice;
  if (retry.failedEntryId) addHiddenEntryId(live, retry.failedEntryId);

  const activeRun = ensureActiveRun(state, {
    conversationId: data.conversationId,
    agentId: data.agentId,
    projectId: data.projectId,
    runId: data.runId,
    startedAt: ts,
  });
  activeRun.status = "retrying";
  activeRun.retry = retry;
  state.sending = true;
  state.error = undefined;
}

function applyRunSuspended(
  state: ConversationRenderState,
  data: ConversationRunSuspendedData,
): void {
  clearRunLiveState(state, data.runId);
  if (runMatches(state.activeRun?.runId, data.runId))
    state.activeRun = undefined;
  state.sending = false;
}

function applyRunCompleted(
  state: ConversationRenderState,
  data: ConversationRunCompletedData,
): void {
  clearRunLiveState(state, data.runId);
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
  const failedCompaction =
    state.live?.compaction?.state === "failed"
      ? state.live.compaction
      : undefined;
  clearRunLiveState(state, data.runId);
  if (failedCompaction) {
    state.live = { ...emptyLiveState(), compaction: failedCompaction };
  }
  if (runMatches(state.activeRun?.runId, data.runId))
    state.activeRun = undefined;
  state.queuedPrompts = [];
  state.sending = false;
  state.error = data.aborted ? undefined : data.message || "Agent error";
}

function clearRunLiveState(
  state: ConversationRenderState,
  runId?: string,
): void {
  if (!runId || !state.live?.runId || state.live.runId === runId) {
    state.live = emptyLiveState();
  }
}

function applyCompactionStarted(
  state: ConversationRenderState,
  data: ConversationCompactionStartedData,
  ts: string,
): void {
  const live = ensureLiveState(state, data.runId);
  const notice = compactionNoticeFromStarted(data, ts, live.compaction);
  live.compaction = notice;
  if (notice.failedEntryId) addHiddenEntryId(live, notice.failedEntryId);
  state.error = undefined;
}

function applyCompactionFailed(
  state: ConversationRenderState,
  data: ConversationCompactionFailedData,
  ts: string,
): void {
  const live = ensureLiveState(state, data.runId);
  live.compaction = compactionNoticeFromFailed(data, ts, live.compaction);
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

function applyLiveMessageStarted(
  state: ConversationRenderState,
  data: ConversationLiveMessageStartedData,
): void {
  ensureLiveState(state, data.runId);
  ensureActiveRun(state, data);
  ensureActiveMessage(state, data, data.startedAt);
  if (state.live) state.live.runStatus = undefined;
  state.sending = true;
}

function applyLiveContentDelta(
  state: ConversationRenderState,
  data: ConversationLiveContentDeltaData,
  ts: string,
  options: ApplyConversationEventOptions,
): void {
  if (!data.delta) return;
  const live = ensureLiveState(state, data.runId);
  const id = liveTextId(data.liveMessageId, data.kind, data.contentIndex);
  const current = live.messages.find((item) => item.id === id);
  const currentLength = current?.text.length ?? 0;
  if (currentLength > data.offset) return;
  if (currentLength < data.offset) {
    reportGap(options, data, "conversation.live.content.delta");
    return;
  }

  const text = `${current?.text ?? ""}${data.delta}`;
  upsertLiveMessage(live, {
    id,
    role: "assistant",
    displayKind: data.kind === "thinking" ? "thinking" : "message",
    text,
    createdAt: current?.createdAt ?? activeMessageStartedAt(state, data) ?? ts,
    contentIndex: data.contentIndex,
    live: true,
    done: false,
    redacted: current?.redacted,
  });

  const block = ensureActiveTextBlock(state, data, ts);
  if (block) block.text = text;
  state.sending = true;
}

function applyLiveContentDone(
  state: ConversationRenderState,
  data: ConversationLiveContentDoneData,
  ts: string,
): void {
  const live = ensureLiveState(state, data.runId);
  const id = liveTextId(data.liveMessageId, data.kind, data.contentIndex);
  const current = live.messages.find((item) => item.id === id);
  const block = ensureActiveTextBlock(state, data, ts);
  const text = data.finalText ?? current?.text ?? block?.text ?? "";

  if (block) {
    block.text = text;
    block.done = true;
    block.redacted = data.redacted;
  }

  upsertLiveMessage(live, {
    id,
    role: "assistant",
    displayKind: data.kind === "thinking" ? "thinking" : "message",
    text,
    createdAt: current?.createdAt ?? activeMessageStartedAt(state, data) ?? ts,
    contentIndex: data.contentIndex,
    live: false,
    done: true,
    redacted: data.kind === "thinking" ? data.redacted : undefined,
  });
}

function applyToolDraftStarted(
  state: ConversationRenderState,
  data: ConversationLiveToolDraftStartedData,
  ts: string,
): void {
  ensureLiveState(state, data.runId);
  upsertToolDraft(state, data, ts, {});
  ensureActiveToolDraftBlock(state, data, ts);
  state.sending = true;
}

function applyToolDraftDelta(
  state: ConversationRenderState,
  data: ConversationLiveToolDraftDeltaData,
  ts: string,
  options: ApplyConversationEventOptions,
): void {
  const live = ensureLiveState(state, data.runId);
  const key = draftKey(data.liveMessageId, data.contentIndex);
  const current = live.toolDrafts.find((draft) => draft.key === key);
  const currentLength = current?.argsText.length ?? 0;
  if (currentLength > data.offset) return;
  if (currentLength < data.offset) {
    reportGap(options, data, "conversation.live.tool_draft.delta");
    return;
  }
  const argsText = `${current?.argsText ?? ""}${data.delta}`;
  upsertToolDraft(state, data, ts, { argsText });
  const block = ensureActiveToolDraftBlock(state, data, ts);
  if (block) block.argsText = argsText;
}

function applyToolDraftDone(
  state: ConversationRenderState,
  data: ConversationLiveToolDraftDoneData,
  ts: string,
): void {
  upsertToolDraft(state, data, ts, {
    args: data.args,
    done: true,
    providerToolCallId: data.providerToolCallId,
    toolName: data.toolName,
  });
  const block = ensureActiveToolDraftBlock(state, data, ts);
  if (block) {
    block.args = data.args;
    block.done = true;
    block.providerToolCallId = data.providerToolCallId;
    block.toolName = data.toolName;
  }
}

function applyToolDraftProgress(
  state: ConversationRenderState,
  data: ConversationLiveToolDraftProgressData,
  ts: string,
): void {
  upsertToolDraft(state, data, ts, { progress: data.progress });
  const block = ensureActiveToolDraftBlock(state, data, ts);
  if (block) block.progress = data.progress;
}

function applyToolDraftDiscarded(
  state: ConversationRenderState,
  data: ConversationLiveToolDraftDiscardedData,
): void {
  const key = draftKey(data.liveMessageId, data.contentIndex);
  if (state.live) {
    state.live.toolDrafts = removeDiscardedToolDraft(
      state.live.toolDrafts,
      key,
      data.providerToolCallId,
    );
  }
  const message = activeMessage(state, data.turnId, data.liveMessageId);
  if (message) {
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
}

function applyToolOutputDelta(
  state: ConversationRenderState,
  data: ConversationLiveToolOutputDeltaData,
  ts: string,
  options: ApplyConversationEventOptions,
): void {
  if (!data.delta) return;
  const live = ensureLiveState(state, data.runId);
  const previous = live.toolOutputByToolCallId[data.toolCallId];
  const previousTotal =
    previous?.outputLimits?.totalChars ?? previous?.text.length ?? 0;
  if (previousTotal > data.offset) return;
  if (previousTotal < data.offset) {
    reportGap(options, data, "conversation.live.tool_output.delta");
    return;
  }
  const output = capLiveOutput({
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
  });
  live.toolOutputByToolCallId = {
    ...live.toolOutputByToolCallId,
    [data.toolCallId]: output,
  };
  if (state.activeRun) {
    state.activeRun.toolOutputsByToolCallId = {
      ...state.activeRun.toolOutputsByToolCallId,
      [data.toolCallId]: {
        toolCallId: data.toolCallId,
        ...output,
      },
    };
  }
}

function ensureLiveState(
  state: ConversationRenderState,
  runId?: string,
): ConversationLiveState {
  if (!state.live) {
    state.live =
      state.activeRun && (!runId || state.activeRun.runId === runId)
        ? activeRunToLegacyLive(state.activeRun, {
            excludeLiveMessageIds: durableLiveMessageIds(state),
          })
        : emptyLiveState(runId);
    return state.live;
  }
  if (!runId || state.live.runId === runId || !state.live.runId) {
    state.live = { ...state.live, runId: runId || state.live.runId };
    return state.live;
  }
  state.live = emptyLiveState(runId);
  return state.live;
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
  let turn = run.turns.find((item) => item.turnId === data.turnId);
  if (!turn) {
    turn = {
      turnId: data.turnId,
      ordinal: run.turns.length,
      messages: [],
    };
    run.turns.push(turn);
  }
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

function upsertLiveMessage(
  live: ConversationLiveState,
  item: TranscriptItem,
): void {
  const index = live.messages.findIndex(
    (candidate) => candidate.id === item.id,
  );
  live.messages =
    index === -1
      ? [...live.messages, item]
      : live.messages.map((candidate) =>
          candidate.id === item.id ? item : candidate,
        );
}

function upsertToolDraft(
  state: ConversationRenderState,
  data:
    | ConversationLiveToolDraftStartedData
    | ConversationLiveToolDraftDeltaData
    | ConversationLiveToolDraftDoneData
    | ConversationLiveToolDraftProgressData,
  ts: string,
  patch: Partial<LiveToolCallDraft>,
): void {
  const live = ensureLiveState(state, data.runId);
  const key = draftKey(data.liveMessageId, data.contentIndex);
  const current = live.toolDrafts.find((draft) => draft.key === key);
  const updated: LiveToolCallDraft = {
    kind: "tool_call_draft",
    key,
    runId: data.runId,
    conversationId: data.conversationId,
    contentIndex: data.contentIndex,
    providerToolCallId:
      patch.providerToolCallId ??
      data.providerToolCallId ??
      current?.providerToolCallId,
    toolName: patch.toolName ?? data.toolName ?? current?.toolName,
    argsText: patch.argsText ?? current?.argsText ?? "",
    args: patch.args ?? current?.args,
    progress: patch.progress ?? current?.progress,
    done: patch.done ?? current?.done,
    createdAt: current?.createdAt ?? activeMessageStartedAt(state, data) ?? ts,
    updatedAt: ts,
  };
  live.toolDrafts = current
    ? live.toolDrafts.map((draft) => (draft.key === key ? updated : draft))
    : [...live.toolDrafts, updated];
}

export function removeDiscardedToolDraft(
  drafts: LiveToolCallDraft[],
  key: string,
  providerToolCallId?: string,
): LiveToolCallDraft[] {
  return drafts.filter(
    (draft) =>
      draft.key !== key &&
      (!providerToolCallId || draft.providerToolCallId !== providerToolCallId),
  );
}

function removeLiveDraftsForProviderIds(
  state: ConversationRenderState,
  providerToolCallIds: string[],
): void {
  if (providerToolCallIds.length === 0) return;
  const ids = new Set(providerToolCallIds);
  if (state.live) {
    state.live.toolDrafts = state.live.toolDrafts.filter(
      (draft) =>
        !draft.providerToolCallId || !ids.has(draft.providerToolCallId),
    );
  }
  if (state.activeRun) {
    for (const turn of state.activeRun.turns) {
      for (const message of turn.messages) {
        message.blocks = message.blocks.filter(
          (block) =>
            block.kind !== "tool_call_draft" ||
            !block.providerToolCallId ||
            !ids.has(block.providerToolCallId),
        );
      }
    }
  }
}

function durableLiveMessageIds(state: ConversationRenderState): Set<string> {
  const ids = new Set<string>();
  for (const entry of state.entries) {
    if (entry.liveMessageId) ids.add(entry.liveMessageId);
  }
  return ids;
}

function liveTextId(
  liveMessageId: string,
  kind: "text" | "thinking",
  contentIndex: number,
): string {
  return `live:${liveMessageId}:${kind}:${contentIndex}`;
}

function draftKey(liveMessageId: string, contentIndex: number): string {
  return `live:${liveMessageId}:tool-draft:${contentIndex}`;
}

export function capLiveOutput(output: LiveToolOutput): LiveToolOutput {
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

function addHiddenEntryId(live: ConversationLiveState, entryId: string): void {
  live.hiddenEntryIds = Array.from(
    new Set([...(live.hiddenEntryIds ?? []), entryId]),
  );
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
