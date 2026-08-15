import { voiceInputSession } from "$lib/core/audio/voice-input-session.svelte";
import { protocolRequest } from "@nervekit/protocol";
import { conversationStream } from "@nervekit/contracts";
import { removeEventStream } from "$lib/core/events/stream-cursors.svelte";
import {
  conversationViewKey,
  pendingConversationKey,
} from "$lib/core/state/state-keys";
import { conversationState } from "$lib/features/conversations/state/conversation-state.svelte";
import { closeCenterTabs } from "$lib/features/workspace/state/center-tab-actions.svelte";
import type { CenterTabCloseContext } from "$lib/features/workspace/state/center-tab-lifecycle.svelte";
import { selectCenterTab } from "$lib/features/workspace/state/center-tab-lifecycle.svelte";
import { setActiveCenterTab } from "$lib/features/workspace/state/center-tabs.svelte";
import { conversationContextState } from "$lib/features/workspace/state/selection.svelte";
import { removeTabsFromAllSessions } from "$lib/features/workspace/state/workspace-tab-sessions";
import { workspaceState } from "$lib/features/workspace/state/workspace-state.svelte";
import {
  applyActiveConversationSelection,
  refreshConversationView,
} from "./selection";
import {
  addConversationTab,
  clearActiveSelection,
  ensureConversationView,
  persistConversationTabs,
} from "./state";

export async function openConversation(conversationId: string) {
  const conversation =
    workspaceState.conversations.find(
      (candidate) => candidate.id === conversationId,
    ) ??
    (await protocolRequest("conversation.get", { conversationId })).result
      .conversation;
  if (conversation.projectId !== workspaceState.selectedProjectId) {
    const { selectProject } =
      await import("$lib/features/workspace/state/workspace-actions.svelte");
    await selectProject(conversation.projectId);
  }
  addConversationTab(conversation.id);
  setActiveCenterTab({ kind: "conversation", id: conversation.id });
  persistConversationTabs();
  await applyActiveConversationSelection(conversation);
  await refreshConversationView(conversation.id);
  const view = ensureConversationView(conversation.id);
  workspaceState.error = view.error;
}

export async function restoreConversationTabs(
  desiredTab = workspaceState.activeCenterTab,
): Promise<boolean> {
  const tabIds = workspaceState.openCenterTabs
    .filter((tab) => tab.kind === "conversation")
    .map((tab) => tab.id);
  for (const conversationId of tabIds) ensureConversationView(conversationId);
  if (desiredTab?.kind !== "conversation") return false;
  await selectCenterTab(desiredTab);
  return true;
}

export async function disposeConversationTab(
  conversationId: string,
): Promise<void> {
  await voiceInputSession.cancelIfTarget({
    kind: "conversation",
    id: conversationId,
  });
  delete conversationState.conversationViews[
    conversationViewKey(conversationId)
  ];
  removeEventStream(conversationStream(conversationId));
}

export async function disposePendingConversationTab(
  pendingId: string,
): Promise<void> {
  await voiceInputSession.cancelIfTarget({
    kind: "pending-conversation",
    id: pendingId,
  });
  delete conversationState.pendingConversations[
    pendingConversationKey(pendingId)
  ];
}

export function afterCloseConversationTab(
  _id: string,
  context: CenterTabCloseContext,
): void {
  if (
    context.activeWasClosed &&
    !context.remainingTabs.some(
      (tab) =>
        tab.kind === "conversation" || tab.kind === "pending-conversation",
    )
  ) {
    clearActiveSelection();
  }
}

export async function removeConversationTabs(
  conversationIds: string[],
): Promise<void> {
  const removing = new Set(conversationIds);
  const tabs = workspaceState.openCenterTabs.filter(
    (tab) => tab.kind === "conversation" && removing.has(tab.id),
  );
  await closeCenterTabs(tabs);
  const visibleIds = new Set(tabs.map((tab) => tab.id));
  for (const conversationId of removing) {
    if (!visibleIds.has(conversationId))
      await disposeConversationTab(conversationId);
  }
  removeTabsFromAllSessions(
    (tab) => tab.kind === "conversation" && removing.has(tab.id),
  );
  const selectedAgent = workspaceState.agents.find(
    (agent) => agent.id === conversationContextState.selectedAgentId,
  );
  if (
    selectedAgent?.conversationId &&
    removing.has(selectedAgent.conversationId)
  )
    clearActiveSelection();
  persistConversationTabs();
}
