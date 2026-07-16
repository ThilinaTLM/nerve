import { toolCallTranscriptRecordSchema } from "@nervekit/contracts";
import { applyConversationEvent } from "@nervekit/workbench-ui/state";
import type {
  ConversationEntry,
  EventEnvelope,
  ToolCallTranscriptRecord,
} from "$lib/api";
import { conversationViewKey } from "$lib/core/state/state-keys";
import type { ConversationViewState } from "$lib/core/types/state-types";
import { conversationState } from "$lib/features/conversations/state/conversation-state.svelte";
import {
  ensureConversationView,
  openConversation,
  refreshConversationView,
} from "$lib/features/conversations/state/conversation-flow.svelte";
import { invalidateGit } from "$lib/features/git/state/git-context.svelte";
import { selection } from "$lib/features/workspace/state/selection.svelte";
import { conversationIdFromEvent } from "./conversation-event-routing";
import {
  clearContextUsageRefresh,
  scheduleContextUsageRefresh,
} from "./conversation-context-usage";
import { reconcileOptimisticMessages } from "./conversation-optimistic";
import { applyConversationTerminalUiState } from "./conversation-terminal-state";
import {
  active,
  entryBelongsToActiveBranch,
  isOpenConversation,
  stringValue,
  syncActiveView,
  updateConversationActiveEntryId,
  updateTreeNodesForEntry,
} from "./conversation-reducer-shared";

export { refreshContextUsage } from "./conversation-context-usage";
export { isOpenConversation } from "./conversation-reducer-shared";

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : undefined;
}

function toolCallFromEntry(
  entry: ConversationEntry,
): ToolCallTranscriptRecord | undefined {
  const details = recordValue(entry.details);
  const nestedDetails = recordValue(details?.details);
  for (const candidate of [details?.toolCall, nestedDetails?.toolCall]) {
    const parsed = toolCallTranscriptRecordSchema.safeParse(candidate);
    if (parsed.success) return parsed.data;
  }
  return undefined;
}

function upsertToolCall(
  view: ConversationViewState,
  toolCall: ToolCallTranscriptRecord | undefined,
): void {
  if (!toolCall) return;
  if (toolCall.hidden) {
    view.toolCalls = view.toolCalls.filter(
      (candidate) => candidate.id !== toolCall.id,
    );
    return;
  }
  const index = view.toolCalls.findIndex(
    (candidate) => candidate.id === toolCall.id,
  );
  view.toolCalls =
    index === -1
      ? [...view.toolCalls, toolCall]
      : view.toolCalls.map((candidate) =>
          candidate.id === toolCall.id ? toolCall : candidate,
        );
}

/**
 * Route a protocol conversation event through the shared canonical reducer,
 * then apply app-only effects (branch/tree upkeep, selection, optimistic-row
 * reconciliation, context refresh scheduling, git invalidation).
 */
export function handleConversationEvent(
  event: EventEnvelope<Record<string, unknown>>,
) {
  const conversationId = conversationIdFromEvent(event);
  if (!conversationId || !isOpenConversation(conversationId)) return;
  const view = ensureConversationView(conversationId);

  // Validate branch membership before materializing an appended entry; on
  // divergence the snapshot refresh rebuilds coherent state.
  const entry =
    event.type === "conversation.entry.appended" ||
    event.type === "conversation.compacted"
      ? (event.data?.entry as ConversationEntry | undefined)
      : undefined;
  if (
    event.type === "conversation.entry.appended" &&
    entry &&
    event.seq > view.cursorSeq &&
    !entryBelongsToActiveBranch(view, entry)
  ) {
    view.cursorSeq = event.seq;
    void refreshConversationView(conversationId);
    scheduleContextUsageRefresh(conversationId);
    return;
  }

  const applied = applyConversationEvent(view, event, {
    onGap: () => void refreshConversationView(conversationId),
  }) as ConversationViewState;
  let next = view;
  if (applied !== view) {
    const key = conversationViewKey(conversationId);
    conversationState.conversationViews[key] = applied;
    // Re-read so app effects mutate the reactive proxy, not the raw clone.
    next = conversationState.conversationViews[key];
  }

  applyAppEffects(next, event, entry);
  syncActiveView(next);
}

function applyAppEffects(
  view: ConversationViewState,
  event: EventEnvelope<Record<string, unknown>>,
  entry: ConversationEntry | undefined,
): void {
  const conversationId = view.conversationId;
  switch (event.type) {
    case "conversation.entry.appended": {
      if (!entry) break;
      view.activeEntryId = entry.id;
      updateTreeNodesForEntry(view, entry);
      updateConversationActiveEntryId(conversationId, entry.id);
      if (active(conversationId)) selection.entryId = entry.id;
      view.optimisticMessages = reconcileOptimisticMessages(
        view.optimisticMessages,
        entry,
      );
      upsertToolCall(view, toolCallFromEntry(entry));
      scheduleContextUsageRefresh(conversationId);
      break;
    }
    case "conversation.compacted":
      if (entry) {
        view.activeEntryId = entry.id;
        updateTreeNodesForEntry(view, entry);
      }
      break;
    case "conversation.context.updated":
      clearContextUsageRefresh(conversationId);
      break;
    case "run.completed":
      applyConversationTerminalUiState(view);
      void refreshConversationView(conversationId).then(() => {
        if (selection.conversationId === conversationId)
          void openConversation(conversationId);
      });
      if (active(conversationId)) {
        void invalidateGit(stringValue(event.data?.projectId));
      }
      break;
    case "run.cancelled":
      applyConversationTerminalUiState(view);
      break;
    case "run.failed":
      applyConversationTerminalUiState(view);
      break;
    case "run.suspended":
      view.optimisticMessages = [];
      break;
    case "run.waiting":
      // Not part of the shared conversation event surface: the run pauses for
      // human input, so stop treating it as actively sending.
      view.sending = false;
      view.queuedPrompts = [];
      view.error = undefined;
      break;
  }
}
