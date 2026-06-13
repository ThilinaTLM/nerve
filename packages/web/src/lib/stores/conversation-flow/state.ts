import { composerDraft, resetSelection } from "../../state/app-state.svelte";
import { addCenterTab } from "../workbench/center-tabs.svelte";
import { saveConversationTabs } from "../workbench/conversation-tabs";
import type {
  ConversationViewState,
  PendingConversationState,
} from "../workbench/state.svelte";
import { workbenchState } from "../workbench/state.svelte";

export function ensureConversationView(
  conversationId: string,
): ConversationViewState {
  workbenchState.conversationViews[conversationId] ??= {
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
  return workbenchState.conversationViews[conversationId];
}

export function persistConversationTabs() {
  saveConversationTabs(
    workbenchState.openConversationTabIds,
    workbenchState.activeConversationTabId,
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
  const active = workbenchState.activeCenterTab;
  if (active?.kind !== "pending-conversation") return undefined;
  return workbenchState.pendingConversations[active.id];
}

export function clearTranscriptState() {
  workbenchState.treeNodes = [];
  workbenchState.transcript = [];
  workbenchState.streamingText = "";
  workbenchState.sending = false;
  workbenchState.error = undefined;
}

export function clearActiveSelection() {
  resetSelection();
  workbenchState.activeConversationTabId = undefined;
  clearTranscriptState();
  composerDraft.text = "";
}
