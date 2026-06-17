import { workbenchState } from "$lib/stores/workbench/state.svelte";

/** Compatibility facade for settings-owned state during migration. */
export const settingsState = {
  get settingsDraft() {
    return workbenchState.settingsDraft;
  },
  set settingsDraft(value) {
    workbenchState.settingsDraft = value;
  },
  get authProviders() {
    return workbenchState.authProviders;
  },
  set authProviders(value) {
    workbenchState.authProviders = value;
  },
  get models() {
    return workbenchState.models;
  },
  set models(value) {
    workbenchState.models = value;
  },
  get settingsSaveStatus() {
    return workbenchState.settingsSaveStatus;
  },
  set settingsSaveStatus(value) {
    workbenchState.settingsSaveStatus = value;
  },
  get settingsMessage() {
    return workbenchState.settingsMessage;
  },
  set settingsMessage(value) {
    workbenchState.settingsMessage = value;
  },
  get settingsTabOpen() {
    return workbenchState.settingsTabOpen;
  },
  set settingsTabOpen(value) {
    workbenchState.settingsTabOpen = value;
  },
};
