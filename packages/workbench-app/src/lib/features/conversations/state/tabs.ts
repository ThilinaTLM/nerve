import type { ConversationRecord } from "$lib/api";
import { voiceInputSession } from "$lib/core/audio/voice-input-session.svelte";
import { protocolRequest } from "@nervekit/protocol";
import {
  conversationViewKey,
  pendingConversationKey,
} from "$lib/core/state/state-keys";
import { conversationState } from "$lib/features/conversations/state/conversation-state.svelte";
import {
  filterStoredTabsAgainstConversations,
  loadStoredConversationTabs,
} from "$lib/features/conversations/state/conversation-tabs";
import {
  nextCenterTabAfterClose,
  removeCenterTab,
  replaceOpenCenterTabs,
  selectCenterTab,
  setActiveCenterTab,
} from "$lib/features/workspace/state/center-tabs.svelte";
import { selection } from "$lib/features/workspace/state/selection.svelte";
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
    (
      await protocolRequest<{ conversation: ConversationRecord }>(
        "conversation.get",
        { conversationId },
      )
    ).result.conversation;
  addConversationTab(conversation.id);
  conversationState.activeConversationTabId = conversation.id;
  setActiveCenterTab({ kind: "conversation", id: conversation.id });
  persistConversationTabs();
  await applyActiveConversationSelection(conversation);
  await refreshConversationView(conversation.id);
  const view = ensureConversationView(conversation.id);
  workspaceState.error = view.error;
}

export async function restoreConversationTabs() {
  const stored = loadStoredConversationTabs();
  const tabIds = filterStoredTabsAgainstConversations(
    stored.tabIds,
    workspaceState.conversations,
  );
  replaceOpenCenterTabs(tabIds.map((id) => ({ kind: "conversation", id })));
  for (const conversationId of tabIds) ensureConversationView(conversationId);
  const activeId =
    stored.activeId && tabIds.includes(stored.activeId)
      ? stored.activeId
      : tabIds[0];
  conversationState.activeConversationTabId = activeId;
  persistConversationTabs();
  if (activeId) await openConversation(activeId);
}

export async function closeConversationTab(conversationId: string) {
  const currentIds = conversationState.openConversationTabIds;
  const closingIndex = currentIds.indexOf(conversationId);
  if (closingIndex === -1) return;
  const tab = { kind: "conversation" as const, id: conversationId };
  const fallback = nextCenterTabAfterClose(tab);
  const nextIds = currentIds.filter((id) => id !== conversationId);
  const nextConversationId = nextIds[closingIndex] ?? nextIds[closingIndex - 1];
  await voiceInputSession.cancelIfTarget({
    kind: "conversation",
    id: conversationId,
  });
  removeCenterTab(tab);
  delete conversationState.conversationViews[
    conversationViewKey(conversationId)
  ];

  const closingActiveCenter =
    workspaceState.activeCenterTab?.kind === "conversation" &&
    workspaceState.activeCenterTab.id === conversationId;

  if (conversationState.activeConversationTabId === conversationId) {
    conversationState.activeConversationTabId = nextConversationId;
  }

  if (selection.conversationId === conversationId && !nextConversationId) {
    clearActiveSelection();
  }

  persistConversationTabs();

  if (closingActiveCenter) {
    await selectCenterTab(fallback);
  }
}

export async function closePendingConversationTab(pendingId: string) {
  const pending =
    conversationState.pendingConversations[pendingConversationKey(pendingId)];
  if (!pending) return;
  const tab = { kind: "pending-conversation" as const, id: pendingId };
  const fallback = nextCenterTabAfterClose(tab);
  const closingActiveCenter =
    workspaceState.activeCenterTab?.kind === "pending-conversation" &&
    workspaceState.activeCenterTab.id === pendingId;
  await voiceInputSession.cancelIfTarget({
    kind: "pending-conversation",
    id: pendingId,
  });
  removeCenterTab(tab);
  delete conversationState.pendingConversations[
    pendingConversationKey(pendingId)
  ];
  if (closingActiveCenter) {
    clearActiveSelection();
    await selectCenterTab(fallback);
  }
  persistConversationTabs();
}

export async function removeConversationTabs(conversationIds: string[]) {
  const removing = new Set(conversationIds);
  const activeRemoved = selection.conversationId
    ? removing.has(selection.conversationId)
    : false;
  await voiceInputSession.cancelIfTargets(
    conversationIds.map((id) => ({ kind: "conversation", id })),
  );
  replaceOpenCenterTabs(
    workspaceState.openCenterTabs.filter(
      (tab) => tab.kind !== "conversation" || !removing.has(tab.id),
    ),
  );
  for (const conversationId of removing)
    delete conversationState.conversationViews[
      conversationViewKey(conversationId)
    ];

  if (!activeRemoved) {
    persistConversationTabs();
    return;
  }

  const nextConversationId = conversationState.openConversationTabIds[0];
  if (nextConversationId) {
    conversationState.activeConversationTabId = nextConversationId;
    persistConversationTabs();
    await openConversation(nextConversationId);
    return;
  }

  clearActiveSelection();
  await selectCenterTab(workspaceState.openCenterTabs[0]);
  persistConversationTabs();
}
