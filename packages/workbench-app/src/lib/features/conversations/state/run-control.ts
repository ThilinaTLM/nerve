import { cancelConversationCompaction, compactConversation } from "$lib/api";
import { protocolRequest } from "@nervekit/protocol";
import { queryClient, queryKeys } from "$lib/platform/query/client";
import { conversationViewKey } from "$lib/kernel/navigation/view-keys";
import type { CompactionNotice } from "$lib/features/conversations/state/conversation-state.svelte";
import { conversationState } from "$lib/features/conversations/state/conversation-state.svelte";
import { flushAgentConfigChanges } from "$lib/features/conversations/state/agent-config-mutations.svelte";
import { notify } from "$lib/application/notifications/notify.svelte";
import { selection } from "$lib/application/workspace/selection.svelte";
import { reloadWorkspace } from "$lib/application/workspace/workspace-commands";
import { workspaceState } from "$lib/application/workspace/workspace-state.svelte";
import { createAbortActiveRun } from "./run-abort";
import { ensureConversationView } from "./state";
import { openConversation } from "./tabs";

export async function navigateToEntry(
  entryId: string | undefined,
  summarize = false,
): Promise<boolean> {
  if (!selection.conversationId) return false;
  const conversationId = selection.conversationId;
  try {
    await protocolRequest("conversation.navigate", {
      conversationId,
      activeEntryId: entryId ?? null,
      summarize,
    });
    await queryClient.invalidateQueries({ queryKey: queryKeys.workspace });
    await reloadWorkspace();
    await openConversation(conversationId);
    return true;
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : String(caught);
    notify.error("Could not branch conversation", { description: message });
    return false;
  }
}

export async function compactActiveConversation() {
  if (!selection.conversationId) return;
  const conversationId = selection.conversationId;
  compactionCancellationRequested.delete(conversationId);
  const view = ensureConversationView(conversationId);
  const notice: CompactionNotice = {
    id: `local:compaction:${conversationId}:${Date.now()}`,
    state: "running",
    reason: "manual",
    conversationId,
    createdAt: new Date().toISOString(),
  };
  view.transient = { ...view.transient, compaction: notice };
  view.error = undefined;
  try {
    await compactConversation(conversationId);
    view.transient = { ...view.transient, compaction: undefined };
    await queryClient.invalidateQueries({ queryKey: queryKeys.workspace });
    await reloadWorkspace();
    await openConversation(conversationId);
  } catch (caught) {
    if (compactionCancellationRequested.delete(conversationId)) return;
    const message = caught instanceof Error ? caught.message : String(caught);
    view.transient = {
      ...view.transient,
      compaction: {
        ...notice,
        state: "failed",
        errorMessage: message,
      },
    };
    notify.error("Compaction failed", { description: message });
  }
}

const compactionCancellationsInFlight = new Set<string>();
const compactionCancellationRequested = new Set<string>();

export async function cancelActiveCompaction(): Promise<void> {
  if (!selection.conversationId) return;
  const conversationId = selection.conversationId;
  const view = ensureConversationView(conversationId);
  const notice = view.transient?.compaction;
  if (
    notice?.state !== "running" ||
    compactionCancellationsInFlight.has(conversationId)
  )
    return;

  compactionCancellationsInFlight.add(conversationId);
  compactionCancellationRequested.add(conversationId);
  view.stopping = true;
  try {
    await Promise.all([
      cancelConversationCompaction(conversationId),
      notice.runId ? abortActiveRun() : Promise.resolve(),
    ]);
  } catch (caught) {
    compactionCancellationRequested.delete(conversationId);
    const message = caught instanceof Error ? caught.message : String(caught);
    notify.error("Could not stop compaction", { description: message });
  } finally {
    compactionCancellationsInFlight.delete(conversationId);
    const current =
      conversationState.conversationViews[conversationViewKey(conversationId)];
    if (current) current.stopping = false;
  }
}

export async function continueFromFailure(runId: string) {
  if (!selection.agentId || !selection.conversationId) return;
  const agentId = selection.agentId;
  const conversationId = selection.conversationId;
  const view = ensureConversationView(conversationId);
  view.sending = true;
  view.error = undefined;
  workspaceState.error = undefined;
  try {
    // The user may have selected a replacement model specifically to recover
    // this run. Ensure that configuration is authoritative before resuming.
    await flushAgentConfigChanges(agentId);
    await protocolRequest(
      "run.continue",
      {
        agentId,
        conversationId,
        runId,
        reason: "manual",
      },
      { idempotencyKey: crypto.randomUUID() },
    );
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : String(caught);
    view.sending = false;
    view.error = message;
    workspaceState.error = message;
    notify.error("Continue failed", { description: message });
  }
}

export const abortActiveRun = createAbortActiveRun({
  agentId: () => selection.agentId,
  view: (conversationId = selection.conversationId) =>
    conversationId
      ? conversationState.conversationViews[conversationViewKey(conversationId)]
      : undefined,
  cancelRun: async (agentId, runId) => {
    await protocolRequest(
      "run.cancel",
      { agentId, runId },
      { idempotencyKey: crypto.randomUUID() },
    );
  },
  notifyError: (title, options) => notify.error(title, options),
});
