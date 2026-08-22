import { settingsState } from "$lib/features/settings/state/settings-state.svelte";

/** Read-only reactive settings data consumed outside the settings feature. */
export const settingsReadModel = {
  get settingsDraft() {
    return settingsState.settingsDraft;
  },
  get models() {
    return settingsState.models;
  },
  get authProviders() {
    return settingsState.authProviders;
  },
};
