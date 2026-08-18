import { settingsState } from "$lib/features/settings/state/settings-state.svelte";

/** Optional link decoration derived from the orchestrated core settings load. */
function selectedSiteUrl(provider: "jira" | "confluence"): string | undefined {
  const settings = settingsState.settingsDraft;
  if (!settings) return undefined;
  const profileId = settings.tools[provider].profileId;
  return settings.providers.atlassianProfiles.find(
    (profile) => profile.id === profileId,
  )?.siteUrl;
}

export function jiraSiteUrl(): string | undefined {
  return selectedSiteUrl("jira");
}

export function confluenceSiteUrl(): string | undefined {
  return selectedSiteUrl("confluence");
}
