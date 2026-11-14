import { selectedAtlassianAccountId } from "$lib/application/extensions/selected-accounts.svelte";
import { settingsReadModel } from "$lib/application/preferences/settings-read-model.svelte";

/** Optional link decoration: the site of the Atlassian account the extension selects. */
function selectedSiteUrl(): string | undefined {
  const selected = selectedAtlassianAccountId();
  return settingsReadModel.settingsDraft?.providers.atlassianProfiles.find(
    (profile) => profile.id === selected,
  )?.siteUrl;
}

export function jiraSiteUrl(): string | undefined {
  return selectedSiteUrl();
}

export function confluenceSiteUrl(): string | undefined {
  return selectedSiteUrl();
}
