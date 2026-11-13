import { settingsReadModel } from "$lib/application/preferences/settings-read-model.svelte";

/**
 * Optional link decoration derived from the orchestrated core settings load.
 * TODO(extensions-page): the selected account lives in extension settings now;
 * until the Extensions page reads it, only a single account is unambiguous.
 */
function selectedSiteUrl(): string | undefined {
  const profiles = settingsReadModel.settingsDraft?.providers.atlassianProfiles;
  return profiles?.length === 1 ? profiles[0]?.siteUrl : undefined;
}

export function jiraSiteUrl(): string | undefined {
  return selectedSiteUrl();
}

export function confluenceSiteUrl(): string | undefined {
  return selectedSiteUrl();
}
