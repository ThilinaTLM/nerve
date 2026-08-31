import type {
  AtlassianProfile,
  AuthProviderMetadata,
  Settings,
  TavilyProfile,
  UpdateSettingsRequest,
} from "$lib/api";

export function createProfileId(): string {
  return crypto.randomUUID();
}

export function atlassianCredentialId(profileId: string): string {
  return `atlassian:${profileId}`;
}

export function tavilyCredentialId(profileId: string): string {
  return `tavily:${profileId}`;
}

export function normalizeAtlassianSiteUrl(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed || /\s/.test(trimmed)) return undefined;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
  try {
    const url = new URL(withScheme);
    if (!["http:", "https:"].includes(url.protocol) || !url.hostname) {
      return undefined;
    }
    if (url.search || url.hash) return undefined;
    const path = url.pathname.replace(/\/+$/, "").replace(/\/wiki$/i, "");
    return `${url.origin}${path}`;
  } catch {
    return undefined;
  }
}

export function credentialConfigured(
  authProviders: AuthProviderMetadata[],
  credentialId: string,
): boolean {
  const provider = authProviders.find((item) => item.provider === credentialId);
  return Boolean(provider?.configured && provider.credentialType === "api_key");
}

export function atlassianProfileReady(
  profile: AtlassianProfile | undefined,
  authProviders: AuthProviderMetadata[],
): boolean {
  return Boolean(
    profile?.siteUrl &&
    profile.email &&
    credentialConfigured(authProviders, atlassianCredentialId(profile.id)),
  );
}

export function tavilyProfileReady(
  profile: TavilyProfile | undefined,
  authProviders: AuthProviderMetadata[],
): boolean {
  return Boolean(
    profile &&
    credentialConfigured(authProviders, tavilyCredentialId(profile.id)),
  );
}

export function upsertProfile<T extends { id: string }>(
  profiles: T[],
  profile: T,
): T[] {
  const index = profiles.findIndex((item) => item.id === profile.id);
  if (index < 0) return [...profiles, profile];
  return profiles.map((item) => (item.id === profile.id ? profile : item));
}

export function removeAtlassianProfilePatch(
  settings: Settings,
  profileId: string,
): UpdateSettingsRequest {
  const jiraSelected = settings.tools.jira.profileId === profileId;
  const confluenceSelected = settings.tools.confluence.profileId === profileId;
  return {
    providers: {
      atlassianProfiles: settings.providers.atlassianProfiles.filter(
        (profile) => profile.id !== profileId,
      ),
    },
    tools: {
      ...(jiraSelected ? { jira: { enabled: false, profileId: null } } : {}),
      ...(confluenceSelected
        ? { confluence: { enabled: false, profileId: null } }
        : {}),
    },
  };
}

export function removeTavilyProfilePatch(
  settings: Settings,
  profileId: string,
): UpdateSettingsRequest {
  const selected = settings.tools.web.tavilyProfileId === profileId;
  const disabled = selected
    ? [...new Set([...settings.tools.disabled, "web_search" as const])]
    : settings.tools.disabled;
  return {
    providers: {
      tavilyProfiles: settings.providers.tavilyProfiles.filter(
        (profile) => profile.id !== profileId,
      ),
    },
    ...(selected
      ? { tools: { web: { tavilyProfileId: null }, disabled } }
      : {}),
  };
}
