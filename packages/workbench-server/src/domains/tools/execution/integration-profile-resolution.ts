import type { AtlassianProfile, Settings } from "@nervekit/contracts";

export type AtlassianToolProvider = "jira" | "confluence";

export function selectedAtlassianProfile(
  settings: Settings,
  provider: AtlassianToolProvider,
): AtlassianProfile | undefined {
  const profileId = settings.tools[provider].profileId;
  return profileId
    ? settings.providers.atlassianProfiles.find(
        (profile) => profile.id === profileId,
      )
    : undefined;
}

export function integrationCredentialProvider(
  settings: Settings,
  provider: string,
): string | undefined {
  if (provider === "jira" || provider === "confluence") {
    const profile = selectedAtlassianProfile(settings, provider);
    return profile ? `atlassian:${profile.id}` : undefined;
  }
  if (provider === "tavily") {
    const profileId = settings.tools.web.tavilyProfileId;
    return profileId ? `tavily:${profileId}` : undefined;
  }
  return provider;
}

export function integrationProviderConfig(
  settings: Settings,
  provider: string,
): Record<string, unknown> | undefined {
  if (provider !== "jira" && provider !== "confluence") return undefined;
  const tool = settings.tools[provider];
  const profile = selectedAtlassianProfile(settings, provider);
  if (provider === "jira") {
    return {
      enabled: tool.enabled,
      siteUrl: profile?.siteUrl,
      email: profile?.email,
      defaultProjectKey: profile?.defaultProjectKey,
    };
  }
  return {
    enabled: tool.enabled,
    siteUrl: profile?.siteUrl,
    email: profile?.email,
    defaultSpaceKey: profile?.defaultSpaceKey,
  };
}
