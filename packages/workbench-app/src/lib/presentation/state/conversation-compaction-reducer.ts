import {
  ConversationCompactionCancelledData,
  ConversationCompactionFailedData,
  ConversationCompactionProgressData,
  ConversationCompactionStartedData,
} from "@nervekit/contracts/conversations";
import type {
  CompactionNotice,
  ConversationTransientState,
} from "./transcript-types.js";
import type { ConversationRenderState } from "./conversation-render-state.js";

export function applyCompactionStarted(
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

export function applyCompactionProgress(
  state: ConversationRenderState,
  data: ConversationCompactionProgressData,
  ts: string,
): void {
  const current = state.transient?.compaction;
  // Terminal states win; a late snapshot must not revive a finished notice.
  if (current && current.state !== "running") return;
  if (
    current?.previewSequence !== undefined &&
    data.sequence <= current.previewSequence
  ) {
    return;
  }
  const transient = ensureTransient(state);
  // A snapshot can arrive first after a resync that started mid-compaction.
  const base: CompactionNotice = current ?? {
    id: liveCompactionId(data.conversationId, data.runId, data.reason),
    state: "running",
    reason: data.reason,
    conversationId: data.conversationId,
    agentId: data.agentId,
    runId: data.runId,
    createdAt: ts,
  };
  transient.compaction = {
    ...base,
    summaryPreview: data.preview,
    previewSequence: data.sequence,
    generatedLines: data.generatedLines,
    generatedChars: data.generatedChars,
  };
}

export function applyCompactionFailed(
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

export function applyCompactionCancelled(
  state: ConversationRenderState,
  data: ConversationCompactionCancelledData,
  ts: string,
): void {
  const current = state.transient?.compaction;
  const transient = ensureTransient(state);
  transient.compaction = {
    id:
      current?.id ??
      liveCompactionId(data.conversationId, data.runId, data.reason),
    state: "cancelled",
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
    createdAt: current?.createdAt ?? ts,
    completedAt: data.cancelledAt,
  };
}

export function applyCompacted(state: ConversationRenderState): void {
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

export function clearTransientCompaction(state: ConversationRenderState): void {
  if (!state.transient?.compaction) return;
  state.transient = { ...state.transient, compaction: undefined };
}
