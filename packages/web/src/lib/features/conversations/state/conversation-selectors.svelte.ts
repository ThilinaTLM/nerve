import { workbenchSelectors } from "$lib/stores/workbench/selectors.svelte";

export const conversationSelectors = {
  get activeProject() {
    return workbenchSelectors.activeProject;
  },
  get activeConversation() {
    return workbenchSelectors.activeConversation;
  },
  get activeAgent() {
    return workbenchSelectors.activeAgent;
  },
  get activePendingConversation() {
    return workbenchSelectors.activePendingConversation;
  },
  get pendingConversationActive() {
    return workbenchSelectors.pendingConversationActive;
  },
  get activeUserQuestion() {
    return workbenchSelectors.activeUserQuestion;
  },
  get activePlanReview() {
    return workbenchSelectors.activePlanReview;
  },
  get conversationActivityById() {
    return workbenchSelectors.conversationActivityById;
  },
  get conversationAgents() {
    return workbenchSelectors.conversationAgents;
  },
  get pendingApprovalCount() {
    return workbenchSelectors.pendingApprovalCount;
  },
  get conversationLiveState() {
    return workbenchSelectors.conversationLiveState;
  },
  get transcript() {
    return workbenchSelectors.transcript;
  },
  get toolCalls() {
    return workbenchSelectors.toolCalls;
  },
  get treeNodes() {
    return workbenchSelectors.treeNodes;
  },
  get streamingText() {
    return workbenchSelectors.streamingText;
  },
  get queuedPrompts() {
    return workbenchSelectors.queuedPrompts;
  },
  get activeComposerText() {
    return workbenchSelectors.activeComposerText;
  },
  get gitSuggestions() {
    return workbenchSelectors.gitSuggestions;
  },
  get slashCompletions() {
    return workbenchSelectors.slashCompletions;
  },
  get selectedModelKey() {
    return workbenchSelectors.selectedModelKey;
  },
  get selectedThinkingLevel() {
    return workbenchSelectors.selectedThinkingLevel;
  },
  get selectedMode() {
    return workbenchSelectors.selectedMode;
  },
  get selectedPermissionLevel() {
    return workbenchSelectors.selectedPermissionLevel;
  },
  get activeContextUsage() {
    return workbenchSelectors.activeContextUsage;
  },
  get activeContextWindow() {
    return workbenchSelectors.activeContextWindow;
  },
  get usableModels() {
    return workbenchSelectors.usableModels;
  },
  get live() {
    return workbenchSelectors.live;
  },
  get sending() {
    return workbenchSelectors.sending;
  },
};
