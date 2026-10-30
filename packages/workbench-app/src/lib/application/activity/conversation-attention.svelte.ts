import { untrack } from "svelte";
import {
  attentionPresence,
  configureAttentionDelivery,
  deliverAttention,
} from "$lib/application/notifications/attention-delivery.svelte";
import { setDesktopBadgeCount } from "$lib/platform/desktop/desktop-bridge.svelte";
import { pendingConversations } from "$lib/application/workspace/pending-conversations.svelte";
import { openConversation } from "$lib/application/workspace/workspace-actions.svelte";
import { workspaceSelectors } from "$lib/application/workspace/workspace-selectors.svelte";
import { workspaceState } from "$lib/application/workspace/workspace-state.svelte";
import { ConversationAttention } from "./conversation-attention";
import { deriveNeedsYou } from "./needs-you";
import { unseenResults } from "./unseen-results.svelte";

/** The conversation in the active tab, including a pending tab's created one. */
function activeConversationId(): string | undefined {
  const tab = workspaceState.activeCenterTab;
  if (tab?.kind === "conversation") return tab.id;
  if (tab?.kind === "pending-conversation")
    return pendingConversations.get(tab.id)?.createdConversationId;
  return undefined;
}

/** Ids the user is looking at: the active conversation and its ancestors. */
function viewedConversationIds(): string[] {
  const ids: string[] = [];
  let id = activeConversationId();
  const byId = new Map(
    workspaceSelectors.conversations.map((row) => [row.id, row]),
  );
  while (id && !ids.includes(id)) {
    ids.push(id);
    id = byId.get(id)?.parentConversationId ?? undefined;
  }
  return ids;
}

export const conversationAttention = new ConversationAttention({
  deliver: deliverAttention,
  presence: attentionPresence,
  projectName: (projectId) =>
    workspaceState.projects.find((project) => project.id === projectId)?.name,
  open: (conversationId) => void openConversation(conversationId),
  unseen: unseenResults,
});

function needsYouCount(): number {
  return deriveNeedsYou({
    conversations: workspaceSelectors.conversations,
    activityById: workspaceSelectors.conversationActivityById,
    projectNameById: {},
  }).filter((item) => item.kind === "attention").length;
}

/**
 * Starts attention delivery for the workbench connection: tells delivery what
 * is in front, clears unseen results as they are viewed, and keeps the dock
 * badge in step with the needs-you count.
 */
export function startConversationAttention(): () => void {
  const stopDelivery = configureAttentionDelivery({
    isViewing: (conversationId) =>
      viewedConversationIds().includes(conversationId),
  });
  const stopEffects = $effect.root(() => {
    // Opening or switching to a conversation marks its result as seen.
    // Only the active tab is tracked: a result that arrives while the user is
    // away from an open conversation stays unseen until they are back.
    $effect(() => {
      void activeConversationId();
      untrack(() => {
        for (const id of viewedConversationIds()) unseenResults.delete(id);
      });
    });
    $effect(() => {
      void setDesktopBadgeCount(needsYouCount());
    });
  });
  // Back at the keyboard on an already-open conversation also counts as seeing it.
  const markViewedSeen = () => {
    if (unseenResults.size === 0) return;
    for (const id of viewedConversationIds()) unseenResults.delete(id);
  };
  const events = ["focus", "pointerdown", "keydown"] as const;
  for (const name of events) {
    window.addEventListener(name, markViewedSeen, {
      capture: true,
      passive: true,
    });
  }
  return () => {
    for (const name of events) {
      window.removeEventListener(name, markViewedSeen, true);
    }
    stopEffects();
    stopDelivery();
    conversationAttention.reset();
    void setDesktopBadgeCount(0);
  };
}
