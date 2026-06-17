import { workbenchState } from "$lib/stores/workbench/state.svelte";

/** Compatibility facade for conversation-owned state during migration. */
export const conversationState = {
  get conversationViews() {
    return workbenchState.conversationViews;
  },
  set conversationViews(value) {
    workbenchState.conversationViews = value;
  },
  get pendingConversations() {
    return workbenchState.pendingConversations;
  },
  set pendingConversations(value) {
    workbenchState.pendingConversations = value;
  },
  get openConversationTabIds() {
    return workbenchState.openConversationTabIds;
  },
  set openConversationTabIds(value) {
    workbenchState.openConversationTabIds = value;
  },
  get activeConversationTabId() {
    return workbenchState.activeConversationTabId;
  },
  set activeConversationTabId(value) {
    workbenchState.activeConversationTabId = value;
  },
  get transcript() {
    return workbenchState.transcript;
  },
  set transcript(value) {
    workbenchState.transcript = value;
  },
  get streamingText() {
    return workbenchState.streamingText;
  },
  set streamingText(value) {
    workbenchState.streamingText = value;
  },
  get slashCompletions() {
    return workbenchState.slashCompletions;
  },
  set slashCompletions(value) {
    workbenchState.slashCompletions = value;
  },
  get selectedModelKey() {
    return workbenchState.selectedModelKey;
  },
  set selectedModelKey(value) {
    workbenchState.selectedModelKey = value;
  },
  get selectedThinkingLevel() {
    return workbenchState.selectedThinkingLevel;
  },
  set selectedThinkingLevel(value) {
    workbenchState.selectedThinkingLevel = value;
  },
  get selectedMode() {
    return workbenchState.selectedMode;
  },
  set selectedMode(value) {
    workbenchState.selectedMode = value;
  },
  get selectedPermissionLevel() {
    return workbenchState.selectedPermissionLevel;
  },
  set selectedPermissionLevel(value) {
    workbenchState.selectedPermissionLevel = value;
  },
};
