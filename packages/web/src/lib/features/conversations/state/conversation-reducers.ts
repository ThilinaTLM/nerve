import type {
  ConversationEntry,
  EventEnvelope,
  QueuedPromptRecord,
  ToolCallTranscriptRecord,
} from "$lib/api";
import type { ConversationViewState } from "$lib/core/types/state-types";
import {
  ensureConversationView,
  openConversation,
  refreshConversationView,
} from "$lib/features/conversations/state/conversation-flow.svelte";
import { invalidateGit } from "$lib/features/git/state/git-context.svelte";
import { selection } from "$lib/features/workspace/state/selection.svelte";
import {
  handleCompactionFailed,
  handleCompactionStarted,
} from "./conversation-compaction-reducers";
import {
  clearContextUsageRefresh,
  scheduleContextUsageRefresh,
} from "./conversation-context-usage";
import {
  handleContentDelta,
  handleContentDone,
  handleEntryAppended,
  handleRunRetrying,
  handleToolCallUpdated,
  handleToolDraftDelta,
  handleToolDraftDiscarded,
  handleToolDraftDone,
  handleToolDraftProgress,
  handleToolDraftStarted,
  handleToolOutputDelta,
} from "./conversation-live-reducers";
import {
  active,
  emptyLiveState,
  ensureLiveState,
  isOpenConversation,
  removeLiveRunStatusTranscriptItem,
  stringValue,
  syncActiveView,
} from "./conversation-reducer-shared";

export { clearLiveCompaction } from "./conversation-compaction-reducers";
export { refreshContextUsage } from "./conversation-context-usage";
export { isOpenConversation } from "./conversation-reducer-shared";

export function isConversationRuntimeEvent(type: string): boolean {
  return (
    type === "conversation.entry.appended" ||
    type === "conversation.compaction.started" ||
    type === "conversation.compaction.failed" ||
    type === "conversation.context.updated" ||
    type === "conversation.tool_call.updated" ||
    type.startsWith("conversation.prompt.") ||
    type.startsWith("conversation.run.") ||
    type.startsWith("conversation.live.")
  );
}

export function conversationIdFromEvent(
  event: EventEnvelope<Record<string, unknown>>,
): string | undefined {
  const conversationId = event.data?.conversationId;
  if (typeof conversationId === "string") return conversationId;
  const entry = event.data?.entry as { conversationId?: unknown } | undefined;
  if (typeof entry?.conversationId === "string") return entry.conversationId;
  const toolCall = event.data?.toolCall as
    | { conversationId?: unknown }
    | undefined;
  if (typeof toolCall?.conversationId === "string")
    return toolCall.conversationId;
  return undefined;
}

export function handleConversationEvent(
  event: EventEnvelope<Record<string, unknown>>,
) {
  const conversationId = conversationIdFromEvent(event);
  if (!conversationId || !isOpenConversation(conversationId)) return;
  const view = ensureConversationView(conversationId);
  if (event.seq <= view.cursorSeq) return;
  view.cursorSeq = event.seq;

  switch (event.type) {
    case "conversation.run.started":
      view.sending = true;
      view.queuedPrompts = [];
      view.error = undefined;
      break;
    case "conversation.entry.appended":
      if (
        !handleEntryAppended(
          view,
          event.data?.entry as ConversationEntry | undefined,
        )
      ) {
        void refreshConversationView(conversationId);
      }
      scheduleContextUsageRefresh(conversationId);
      break;
    case "conversation.context.updated":
      clearContextUsageRefresh(conversationId);
      view.contextUsage =
        (event.data?.contextUsage as ConversationViewState["contextUsage"]) ??
        view.contextUsage;
      break;
    case "conversation.prompt.queued":
      upsertQueuedPrompt(
        view,
        event.data?.queuedPrompt as QueuedPromptRecord | undefined,
      );
      break;
    case "conversation.prompt.dequeued":
    case "conversation.prompt.cancelled":
      removeQueuedPrompt(
        view,
        event.data?.queuedPrompt as QueuedPromptRecord | undefined,
      );
      break;
    case "conversation.tool_call.updated":
      handleToolCallUpdated(
        view,
        event.data?.toolCall as ToolCallTranscriptRecord | undefined,
      );
      break;
    case "conversation.run.retrying":
      handleRunRetrying(view, event);
      break;
    case "conversation.compaction.started":
      handleCompactionStarted(view, event);
      break;
    case "conversation.compaction.failed":
      handleCompactionFailed(view, event);
      break;
    case "conversation.live.message.started":
      ensureLiveState(view, String(event.data?.runId ?? ""));
      view.live.runStatus = undefined;
      removeLiveRunStatusTranscriptItem(view, String(event.data?.runId ?? ""));
      view.sending = true;
      break;
    case "conversation.live.content.delta":
      handleContentDelta(view, event);
      break;
    case "conversation.live.content.done":
      handleContentDone(view, event);
      break;
    case "conversation.live.tool_draft.started":
      handleToolDraftStarted(view, event);
      break;
    case "conversation.live.tool_draft.delta":
      handleToolDraftDelta(view, event);
      break;
    case "conversation.live.tool_draft.done":
      handleToolDraftDone(view, event);
      break;
    case "conversation.live.tool_draft.discarded":
      handleToolDraftDiscarded(view, event);
      break;
    case "conversation.live.tool_draft.progress":
      handleToolDraftProgress(view, event);
      break;
    case "conversation.live.tool_output.delta":
      handleToolOutputDelta(view, event);
      break;
    case "conversation.run.completed":
      removeLiveRunStatusTranscriptItem(view, String(event.data?.runId ?? ""));
      view.sending = false;
      view.streamingText = "";
      view.live = emptyLiveState();
      view.activeRun = undefined;
      view.queuedPrompts = [];
      view.error = undefined;
      void refreshConversationView(conversationId).then(() => {
        if (selection.conversationId === conversationId)
          void openConversation(conversationId);
      });
      if (active(conversationId)) {
        void invalidateGit(stringValue(event.data?.projectId));
      }
      break;
    case "conversation.run.failed": {
      removeLiveRunStatusTranscriptItem(view, String(event.data?.runId ?? ""));
      const failedCompaction =
        view.live.compaction?.state === "failed"
          ? view.live.compaction
          : undefined;
      view.sending = false;
      view.streamingText = "";
      view.live = { ...emptyLiveState(), compaction: failedCompaction };
      view.activeRun = undefined;
      view.queuedPrompts = [];
      view.error = event.data?.aborted
        ? undefined
        : String(event.data?.message ?? "Agent error");
      break;
    }
    case "conversation.run.suspended":
      removeLiveRunStatusTranscriptItem(view, String(event.data?.runId ?? ""));
      view.sending = false;
      view.streamingText = "";
      view.live = emptyLiveState();
      view.activeRun = undefined;
      view.queuedPrompts = [];
      view.error = undefined;
      break;
  }

  syncActiveView(view);
}

function upsertQueuedPrompt(
  view: ConversationViewState,
  queuedPrompt: QueuedPromptRecord | undefined,
): void {
  if (!queuedPrompt) return;
  const index = view.queuedPrompts.findIndex(
    (candidate) => candidate.id === queuedPrompt.id,
  );
  view.queuedPrompts =
    index === -1
      ? [...view.queuedPrompts, queuedPrompt]
      : view.queuedPrompts.map((candidate) =>
          candidate.id === queuedPrompt.id ? queuedPrompt : candidate,
        );
}

function removeQueuedPrompt(
  view: ConversationViewState,
  queuedPrompt: QueuedPromptRecord | undefined,
): void {
  if (!queuedPrompt) return;
  view.queuedPrompts = view.queuedPrompts.filter(
    (candidate) => candidate.id !== queuedPrompt.id,
  );
}
