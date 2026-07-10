import type { EventEnvelope } from "$lib/api";
import { conversationViewKey } from "$lib/core/state/state-keys";
import type {
  CompactionNotice,
  ConversationViewState,
} from "$lib/core/types/state-types";
import { conversationState } from "$lib/features/conversations/state/conversation-state.svelte";
import {
  ensureLiveState,
  numberValue,
  stringValue,
  syncActiveView,
} from "./conversation-reducer-shared";

function compactionReasonValue(
  value: unknown,
): CompactionNotice["reason"] | undefined {
  return value === "manual" || value === "threshold" || value === "overflow"
    ? value
    : undefined;
}

function liveCompactionId(
  event: EventEnvelope<Record<string, unknown>>,
): string {
  return `live:compaction:${String(
    event.data?.runId ?? event.data?.conversationId ?? "active",
  )}:${String(event.data?.reason ?? "manual")}`;
}

function compactionNoticeFromEvent(
  event: EventEnvelope<Record<string, unknown>>,
  state: CompactionNotice["state"],
  current?: CompactionNotice,
): CompactionNotice {
  return {
    id: current?.id ?? liveCompactionId(event),
    state,
    reason: compactionReasonValue(event.data?.reason) ?? current?.reason,
    conversationId: stringValue(event.data?.conversationId),
    agentId: stringValue(event.data?.agentId),
    runId: stringValue(event.data?.runId),
    contextWindow:
      numberValue(event.data?.contextWindow) ?? current?.contextWindow,
    contextTokens:
      numberValue(event.data?.contextTokens) ?? current?.contextTokens,
    thresholdTokens:
      numberValue(event.data?.thresholdTokens) ?? current?.thresholdTokens,
    triggerReserveTokens:
      numberValue(event.data?.triggerReserveTokens) ??
      current?.triggerReserveTokens,
    keepRecentTokens:
      numberValue(event.data?.keepRecentTokens) ?? current?.keepRecentTokens,
    failedEntryId:
      stringValue(event.data?.failedEntryId) ?? current?.failedEntryId,
    errorMessage:
      state === "failed"
        ? (stringValue(event.data?.message) ?? current?.errorMessage)
        : current?.errorMessage,
    createdAt:
      stringValue(event.data?.startedAt) ?? current?.createdAt ?? event.ts,
  };
}

export function clearLiveCompaction(
  conversationId: string,
  event: EventEnvelope<Record<string, unknown>>,
): void {
  const view =
    conversationState.conversationViews[conversationViewKey(conversationId)];
  if (!view) return;
  if (event.seq <= view.cursorSeq) return;
  view.cursorSeq = event.seq;
  view.live.compaction = undefined;
  view.error = undefined;
  syncActiveView(view);
}

export function handleCompactionStarted(
  view: ConversationViewState,
  event: EventEnvelope<Record<string, unknown>>,
): void {
  const live = ensureLiveState(view, stringValue(event.data?.runId));
  const notice = compactionNoticeFromEvent(event, "running", live.compaction);
  live.compaction = notice;
  if (notice.failedEntryId) {
    live.hiddenEntryIds = Array.from(
      new Set([...(live.hiddenEntryIds ?? []), notice.failedEntryId]),
    );
  }
  view.error = undefined;
}

export function handleCompactionFailed(
  view: ConversationViewState,
  event: EventEnvelope<Record<string, unknown>>,
): void {
  const live = ensureLiveState(view, stringValue(event.data?.runId));
  const notice = compactionNoticeFromEvent(event, "failed", live.compaction);
  live.compaction = notice;
  if (notice.failedEntryId) {
    live.hiddenEntryIds = (live.hiddenEntryIds ?? []).filter(
      (entryId) => entryId !== notice.failedEntryId,
    );
  }
}
