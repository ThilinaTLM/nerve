import type { ConversationSnapshot } from "@nervekit/contracts/conversations";
import type { AgentQueueItem } from "@nervekit/contracts/agents";
import { fromConversationSnapshot } from "$lib/presentation/state";
import type { ConversationViewState } from "./conversation-state.svelte";
import { stoppingAfterConversationSnapshot } from "./conversation-terminal-state";

/** Display authority is applied independently of auxiliary queue/history availability. */
export function applyCanonicalConversationSnapshot(
  view: ConversationViewState,
  snapshot: ConversationSnapshot,
): boolean {
  if (
    snapshot.conversation.id !== view.conversationId ||
    snapshot.cursorSeq < view.cursorSeq
  )
    return false;
  const canonical = fromConversationSnapshot(snapshot);
  const previousRunId = view.activeRun?.runId;
  view.navigation = snapshot.tree.navigation;
  view.error = undefined;
  view.activeEntryId = snapshot.tree.activeEntryId;
  view.activeEntryIds = canonical.activeEntryIds;
  view.entries = canonical.entries;
  view.toolCalls = canonical.toolCalls;
  view.treeNodes = snapshot.tree.nodes;
  view.activeRun = canonical.activeRun;
  view.transient = undefined;
  view.optimisticMessages = [];
  view.contextUsage = canonical.contextUsage;
  view.cursorSeq = canonical.cursorSeq;
  view.stopping = stoppingAfterConversationSnapshot(
    view.stopping,
    previousRunId,
    canonical.activeRun?.runId,
  );
  view.sending = canonical.sending ?? false;
  return true;
}

export function applyQueueRefresh(
  view: ConversationViewState,
  result: PromiseSettledResult<AgentQueueItem[] | undefined>,
  agentId?: string,
): void {
  if (result.status === "fulfilled") {
    if (
      agentId &&
      result.value?.some(
        (input) =>
          input.agentId !== agentId ||
          input.conversationId !== view.conversationId,
      )
    ) {
      view.queuedPromptsStale = true;
      view.queueError =
        "Queued prompt ownership mismatch. Showing the last known queue.";
      return;
    }
    view.queuedPrompts = result.value ?? [];
    view.queuedPromptsStale = false;
    view.queueError = undefined;
  } else {
    view.queuedPromptsStale = true;
    view.queueError =
      "Queued prompts could not be refreshed. Showing the last known queue.";
  }
}
