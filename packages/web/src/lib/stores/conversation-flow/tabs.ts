import { selection } from "$lib/features/workspace/state/selection.svelte";
import { apiGet, apiPathSegment, type ConversationRecord } from "../../api";
import { voiceInputSession } from "../../audio/voice-input-session.svelte";
import {
  nextCenterTabAfterClose,
  removeCenterTab,
  replaceOpenCenterTabs,
  selectCenterTab,
  setActiveCenterTab,
} from "../workbench/center-tabs.svelte";
import {
  filterStoredTabsAgainstConversations,
  loadStoredConversationTabs,
} from "../workbench/conversation-tabs";
import { workbenchState } from "../workbench/state.svelte";
import {
  conversationViewKey,
  pendingConversationKey,
} from "../workbench/state-keys";
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
    workbenchState.conversations.find(
      (candidate) => candidate.id === conversationId,
    ) ??
    (
      await apiGet<{ conversation: ConversationRecord }>(
        `/api/conversations/${apiPathSegment(conversationId)}`,
      )
    ).conversation;
  addConversationTab(conversation.id);
  workbenchState.activeConversationTabId = conversation.id;
  setActiveCenterTab({ kind: "conversation", id: conversation.id });
  persistConversationTabs();
  await applyActiveConversationSelection(conversation);
  await refreshConversationView(conversation.id);
  const view = ensureConversationView(conversation.id);
  workbenchState.streamingText = view.streamingText;
  workbenchState.sending = view.sending;
  workbenchState.error = view.error;
}

export async function restoreConversationTabs() {
  const stored = loadStoredConversationTabs();
  const tabIds = filterStoredTabsAgainstConversations(
    stored.tabIds,
    workbenchState.conversations,
  );
  replaceOpenCenterTabs(tabIds.map((id) => ({ kind: "conversation", id })));
  for (const conversationId of tabIds) ensureConversationView(conversationId);
  const activeId =
    stored.activeId && tabIds.includes(stored.activeId)
      ? stored.activeId
      : tabIds[0];
  workbenchState.activeConversationTabId = activeId;
  persistConversationTabs();
  if (activeId) await openConversation(activeId);
}

export async function closeConversationTab(conversationId: string) {
  const currentIds = workbenchState.openConversationTabIds;
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
  delete workbenchState.conversationViews[conversationViewKey(conversationId)];

  const closingActiveCenter =
    workbenchState.activeCenterTab?.kind === "conversation" &&
    workbenchState.activeCenterTab.id === conversationId;

  if (workbenchState.activeConversationTabId === conversationId) {
    workbenchState.activeConversationTabId = nextConversationId;
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
    workbenchState.pendingConversations[pendingConversationKey(pendingId)];
  if (!pending) return;
  const tab = { kind: "pending-conversation" as const, id: pendingId };
  const fallback = nextCenterTabAfterClose(tab);
  const closingActiveCenter =
    workbenchState.activeCenterTab?.kind === "pending-conversation" &&
    workbenchState.activeCenterTab.id === pendingId;
  await voiceInputSession.cancelIfTarget({
    kind: "pending-conversation",
    id: pendingId,
  });
  removeCenterTab(tab);
  delete workbenchState.pendingConversations[pendingConversationKey(pendingId)];
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
    workbenchState.openCenterTabs.filter(
      (tab) => tab.kind !== "conversation" || !removing.has(tab.id),
    ),
  );
  for (const conversationId of removing)
    delete workbenchState.conversationViews[
      conversationViewKey(conversationId)
    ];

  if (!activeRemoved) {
    persistConversationTabs();
    return;
  }

  const nextConversationId = workbenchState.openConversationTabIds[0];
  if (nextConversationId) {
    workbenchState.activeConversationTabId = nextConversationId;
    persistConversationTabs();
    await openConversation(nextConversationId);
    return;
  }

  clearActiveSelection();
  await selectCenterTab(workbenchState.openCenterTabs[0]);
  persistConversationTabs();
}
