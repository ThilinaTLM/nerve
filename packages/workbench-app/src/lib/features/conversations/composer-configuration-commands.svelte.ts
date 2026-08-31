import { conversationState } from "./state/conversation-state.svelte";

export const composerConfigurationCommands = {
  setModelKey(value: string): void {
    conversationState.selectedModelKey = value;
  },
  setThinkingLevel(
    value: typeof conversationState.selectedThinkingLevel,
  ): void {
    conversationState.selectedThinkingLevel = value;
  },
  setMode(value: typeof conversationState.selectedMode): void {
    conversationState.selectedMode = value;
  },
  setPermissionLevel(
    value: typeof conversationState.selectedPermissionLevel,
  ): void {
    conversationState.selectedPermissionLevel = value;
  },
  setPermissionRuleSetId(value: string): void {
    conversationState.selectedPermissionRuleSetId = value;
  },
};
