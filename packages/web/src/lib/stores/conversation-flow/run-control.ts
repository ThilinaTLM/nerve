import { notify } from "$lib/notifications/notify.svelte";
import { apiPathSegment, apiPost, compactConversation } from "../../api";
import { queryClient, queryKeys } from "../../query";
import { selection } from "../../state/app-state.svelte";
import type { CompactionNotice } from "../workbench/state.svelte";
import { workbenchState } from "../workbench/state.svelte";
import { loadWorkspaceState } from "../workspace.svelte";
import { ensureConversationView } from "./state";
import { openConversation } from "./tabs";

export async function navigateToEntry(
  entryId: string | undefined,
  summarize = false,
) {
  if (!selection.conversationId) return;
  const conversationId = selection.conversationId;
  await apiPost(
    `/api/conversations/${apiPathSegment(conversationId)}/navigate`,
    {
      activeEntryId: entryId ?? null,
      summarize,
    },
  );
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
  view.live = { ...view.live, compaction: notice };
  view.error = undefined;
  try {
    await compactConversation(conversationId);
    view.live = { ...view.live, compaction: undefined };
    await queryClient.invalidateQueries({ queryKey: queryKeys.workspace });
    await loadWorkspaceState();
    await openConversation(conversationId);
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : String(caught);
    view.live = {
      ...view.live,
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
  workbenchState.sending = true;
  workbenchState.error = undefined;
  try {
    await apiPost(
      `/api/agents/${apiPathSegment(selection.agentId)}/continue-from-failure`,
      {
        statusEntryId,
      },
    );
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : String(caught);
    view.sending = false;
    workbenchState.sending = false;
    view.error = message;
    workbenchState.error = message;
    notify.error("Continue failed", { description: message });
  }
}

export async function abortActiveRun() {
  if (!selection.agentId) return;
  const view = selection.conversationId
    ? ensureConversationView(selection.conversationId)
    : undefined;
  await apiPost(`/api/agents/${apiPathSegment(selection.agentId)}/abort`, {});
  if (view) {
    view.sending = false;
    view.streamingText = "";
    view.live = { messages: [], toolDrafts: [], toolOutputByToolCallId: {} };
    view.queuedPrompts = [];
  }
  workbenchState.sending = false;
  workbenchState.streamingText = "";
}
