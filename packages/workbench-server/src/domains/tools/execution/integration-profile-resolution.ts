import {
  capabilityToolEnabled,
  type CapabilitySelection,
} from "@nervekit/contracts/capabilities";
import type {
  AtlassianProfile,
  Settings,
  TavilyProfile,
} from "@nervekit/contracts/settings";

export type AtlassianToolProvider = "jira" | "confluence";

export type EffectiveAtlassianIntegration = {
  /** Enabled by the resolved selection and backed by an existing profile. */
  enabled: boolean;
  profileId?: string;
  profile?: AtlassianProfile;
};

/**
 * Integration settings after user → project → conversation resolution. Tool
 * advertising and tool execution both derive from this one value.
 */
export type EffectiveIntegrations = {
  jira: EffectiveAtlassianIntegration;
  confluence: EffectiveAtlassianIntegration;
  tavily: { profileId?: string; profile?: TavilyProfile };
};

export function effectiveIntegrations(
  settings: Settings,
  selection: CapabilitySelection,
): EffectiveIntegrations {
  const atlassian = (
    provider: AtlassianToolProvider,
  ): EffectiveAtlassianIntegration => {
    const profileId = selection.toolProfiles[provider];
    const profile = profileId
      ? settings.providers.atlassianProfiles.find(
          (item) => item.id === profileId,
        )
      : undefined;
    return {
      enabled: Boolean(profile) && capabilityToolEnabled(selection, provider),
      profileId,
      profile,
    };
  };
  const tavilyProfileId = selection.toolProfiles.web_search;
  return {
    jira: atlassian("jira"),
    confluence: atlassian("confluence"),
    tavily: {
      profileId: tavilyProfileId,
      profile: tavilyProfileId
        ? settings.providers.tavilyProfiles.find(
            (item) => item.id === tavilyProfileId,
          )
        : undefined,
    },
  };
}

export function integrationCredentialProvider(
  integrations: EffectiveIntegrations,
  provider: string,
): string | undefined {
  if (provider === "jira" || provider === "confluence") {
    const profile = integrations[provider].profile;
    return profile ? `atlassian:${profile.id}` : undefined;
  }
  if (provider === "tavily") {
    const profile = integrations.tavily.profile;
    return profile ? `tavily:${profile.id}` : undefined;
  }
  return provider;
}

export function integrationProviderConfig(
  integrations: EffectiveIntegrations,
  provider: string,
): Record<string, unknown> | undefined {
  if (provider !== "jira" && provider !== "confluence") return undefined;
  const { enabled, profile } = integrations[provider];
  if (provider === "jira") {
    return {
      enabled,
      siteUrl: profile?.siteUrl,
      email: profile?.email,
      defaultProjectKey: profile?.defaultProjectKey,
    };
  }
  return {
    enabled,
    siteUrl: profile?.siteUrl,
    email: profile?.email,
    defaultSpaceKey: profile?.defaultSpaceKey,
  };
}
