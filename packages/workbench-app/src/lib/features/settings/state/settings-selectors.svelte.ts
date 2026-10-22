import { settingsState } from "./settings-state.svelte";

export const settingsSelectors = {
  projectPageId(projectId: string): string | undefined {
    return settingsState.projectViews[projectId]?.pageId;
  },
  get settingsDraft() {
    return settingsState.settingsDraft;
  },
  get settingsSaveStatus() {
    return settingsState.settingsSaveStatus;
  },
  get settingsMessage() {
    return settingsState.settingsMessage;
  },
  get activePageId() {
    return settingsState.activePageId;
  },
};
