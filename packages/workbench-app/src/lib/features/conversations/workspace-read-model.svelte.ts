import { conversationState } from "./state/conversation-state.svelte";

export const conversationWorkspaceReadModel = {
  get activeConversationTabId() {
    return conversationState.activeConversationTabId;
  },
  get conversationViews() {
    return conversationState.conversationViews;
  },
  get pendingConversations() {
    return conversationState.pendingConversations;
  },
  get openConversationTabIds() {
    return conversationState.openConversationTabIds;
  },
  get slashCompletions() {
    return conversationState.slashCompletions;
  },
  get selectedModelKey() {
    return conversationState.selectedModelKey;
  },
  get selectedThinkingLevel() {
    return conversationState.selectedThinkingLevel;
  },
  get selectedMode() {
    return conversationState.selectedMode;
  },
  get selectedPermissionLevel() {
    return conversationState.selectedPermissionLevel;
  },
  get selectedPermissionRuleSetId() {
    return conversationState.selectedPermissionRuleSetId;
  },
};
