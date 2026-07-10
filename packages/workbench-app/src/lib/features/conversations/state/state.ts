import {
  conversationViewKey,
  pendingConversationKey,
} from "$lib/core/state/state-keys";
import type {
  ConversationViewState,
  PendingConversationState,
} from "$lib/core/types/state-types";
import { conversationState } from "$lib/features/conversations/state/conversation-state.svelte";
import { saveConversationTabs } from "$lib/features/conversations/state/conversation-tabs";
import { addCenterTab } from "$lib/features/workspace/state/center-tabs.svelte";
import {
  composerDraft,
  resetSelection,
} from "$lib/features/workspace/state/selection.svelte";
import { workspaceState } from "$lib/features/workspace/state/workspace-state.svelte";

export function ensureConversationView(
  conversationId: string,
): ConversationViewState {
  const key = conversationViewKey(conversationId);
  conversationState.conversationViews[key] ??= {
    conversationId,
    activeEntryId: undefined,
    activeEntryIds: [],
    transcript: [],
    toolCalls: [],
    treeNodes: [],
    streamingText: "",
    live: { messages: [], toolDrafts: [], toolOutputByToolCallId: {} },
    queuedPrompts: [],
    cursorSeq: 0,
    sending: false,
    composerText: "",
    loading: false,
  };
  return conversationState.conversationViews[key];
}

export function persistConversationTabs() {
  saveConversationTabs(
    conversationState.openConversationTabIds,
    conversationState.activeConversationTabId,
  );
}

export function addConversationTab(conversationId: string) {
  addCenterTab({ kind: "conversation", id: conversationId });
  ensureConversationView(conversationId);
}

let pendingConversationCounter = 0;

export function createPendingConversationId(): string {
  pendingConversationCounter += 1;
  return `pending_${Date.now().toString(36)}_${pendingConversationCounter.toString(36)}`;
}

export function activePendingConversation():
  | PendingConversationState
  | undefined {
  const active = workspaceState.activeCenterTab;
  if (active?.kind !== "pending-conversation") return undefined;
  return conversationState.pendingConversations[
    pendingConversationKey(active.id)
  ];
}

export function clearTranscriptState() {
  workspaceState.error = undefined;
}

export function clearActiveSelection() {
  resetSelection();
  conversationState.activeConversationTabId = undefined;
  clearTranscriptState();
  composerDraft.text = "";
}
