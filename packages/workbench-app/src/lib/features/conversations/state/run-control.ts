import { compactConversation } from "$lib/api";
import { protocolRequest } from "@nervekit/protocol";
import { queryClient, queryKeys } from "$lib/core/query";
import type { CompactionNotice } from "$lib/core/types/state-types";
import { notify } from "$lib/features/notifications/notify.svelte";
import { selection } from "$lib/features/workspace/state/selection.svelte";
import { loadWorkspaceState } from "$lib/features/workspace/state/workspace-actions.svelte";
import { workspaceState } from "$lib/features/workspace/state/workspace-state.svelte";
import { createAbortActiveRun } from "./run-abort";
import { ensureConversationView } from "./state";
import { openConversation } from "./tabs";

export async function navigateToEntry(
  entryId: string | undefined,
  summarize = false,
) {
  if (!selection.conversationId) return;
  const conversationId = selection.conversationId;
  await protocolRequest("conversation.navigate", {
    conversationId,
    activeEntryId: entryId ?? null,
    summarize,
  });
  await queryClient.invalidateQueries({ queryKey: queryKeys.workspace });
  await loadWorkspaceState();
  await openConversation(conversationId);
}

export async function compactActiveConversation() {
  if (!selection.conversationId) return;
  const conversationId = selection.conversationId;
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
    await loadWorkspaceState();
    await openConversation(conversationId);
  } catch (caught) {
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

export async function continueFromFailure(statusEntryId: string) {
  if (!selection.agentId || !selection.conversationId) return;
  const view = ensureConversationView(selection.conversationId);
  view.sending = true;
  view.error = undefined;
  workspaceState.error = undefined;
  try {
    await protocolRequest(
      "run.continue",
      { agentId: selection.agentId, statusEntryId },
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
  view: () =>
    selection.conversationId
      ? ensureConversationView(selection.conversationId)
      : undefined,
  cancelRun: async (agentId) => {
    await protocolRequest(
      "run.cancel",
      { agentId },
      { idempotencyKey: crypto.randomUUID() },
    );
  },
  notifyError: (title, options) => notify.error(title, options),
});
