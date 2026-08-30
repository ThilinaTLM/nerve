import { settingsState } from "./state/settings-state.svelte";

export const settingsWorkspaceReadModel = {
  get message() {
    return settingsState.settingsMessage;
  },
  get saveStatus() {
    return settingsState.settingsSaveStatus;
  },
  get tabOpen() {
    return settingsState.settingsTabOpen;
  },
};

export function setSettingsWorkspaceTabOpen(open: boolean): void {
  settingsState.settingsTabOpen = open;
}
