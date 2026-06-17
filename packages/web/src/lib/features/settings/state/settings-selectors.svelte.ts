import { workbenchSelectors } from "$lib/stores/workbench/selectors.svelte";

export const settingsSelectors = {
  get settingsDraft() {
    return workbenchSelectors.settingsDraft;
  },
  get settingsSaveStatus() {
    return workbenchSelectors.settingsSaveStatus;
  },
  get settingsMessage() {
    return workbenchSelectors.settingsMessage;
  },
  get selectedModelKey() {
    return workbenchSelectors.selectedModelKey;
  },
};
