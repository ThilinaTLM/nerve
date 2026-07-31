import { settingsState } from "$lib/features/settings/state/settings-state.svelte";

/** Optional link decoration derived from the orchestrated core settings load. */
export function jiraSiteUrl(): string | undefined {
  return settingsState.settingsDraft?.tools?.jira?.siteUrl;
}

export function confluenceSiteUrl(): string | undefined {
  return settingsState.settingsDraft?.tools?.confluence?.siteUrl;
}
