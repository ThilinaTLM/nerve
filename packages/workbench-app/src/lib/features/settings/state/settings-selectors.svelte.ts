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
};
