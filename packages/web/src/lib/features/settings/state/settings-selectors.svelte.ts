import { conversationState } from "$lib/features/conversations/state/conversation-state.svelte";
import { settingsState } from "./settings-state.svelte";

export const settingsSelectors = {
  get settingsDraft() {
    return settingsState.settingsDraft;
  },
  get settingsSaveStatus() {
    return settingsState.settingsSaveStatus;
  },
  get settingsMessage() {
    return settingsState.settingsMessage;
  },
  get selectedModelKey() {
    return conversationState.selectedModelKey;
  },
};
