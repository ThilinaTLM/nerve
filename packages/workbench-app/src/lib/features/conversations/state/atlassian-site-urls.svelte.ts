import { getSettings } from "$lib/features/settings/api/settings.api";

/**
 * Lazily fetched Atlassian site URLs used by the shared conversation UI to
 * build external Jira/Confluence links. Fetched once per app session; a fetch
 * failure simply leaves the URLs undefined so links degrade to plain text.
 */
const state = $state<{ jira?: string; confluence?: string }>({});

let inflight: Promise<void> | undefined;

export function ensureAtlassianSiteUrls(): void {
  inflight ??= getSettings()
    .then((settings) => {
      state.jira = settings.tools?.jira?.siteUrl;
      state.confluence = settings.tools?.confluence?.siteUrl;
    })
    .catch(() => {
      // Links are optional decoration; keep URLs undefined on failure.
    });
}

export function jiraSiteUrl(): string | undefined {
  return state.jira;
}

export function confluenceSiteUrl(): string | undefined {
  return state.confluence;
}
