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
  return {
    providers: {
      atlassianProfiles: settings.providers.atlassianProfiles.filter(
        (profile) => profile.id !== profileId,
      ),
    },
  };
}
export function removeTavilyProfilePatch(
  settings: Settings,
  profileId: string,
): UpdateSettingsRequest {
  return {
    providers: {
      tavilyProfiles: settings.providers.tavilyProfiles.filter(
        (profile) => profile.id !== profileId,
      ),
    },
  };
}

/** Search terms shared by provider choices, including familiar product aliases. */
export function providerSearchKeywords(id: string, label: string): string[] {
  const aliases = [
    [/anthropic|claude/i, "Anthropic Claude"],
    [/openai|codex/i, "OpenAI Codex ChatGPT"],
    [/google|gemini|vertex/i, "Google Gemini Vertex"],
    [/amazon|bedrock/i, "Amazon AWS Bedrock"],
    [/github|copilot/i, "GitHub Copilot"],
  ] as const;
  return [
    id,
    label,
    id.replace(/[-_:]/g, " "),
    ...aliases
      .filter(([pattern]) => pattern.test(`${id} ${label}`))
      .map(([, alias]) => alias),
  ];
}

export function providerCommandItems(providers: AuthProviderMetadata[]) {
  return [...providers]
    .sort((a, b) => a.displayName.localeCompare(b.displayName))
    .map((provider) => ({
      key: provider.provider,
      label: provider.displayName,
      group: provider.configured ? "Connected" : "Available",
      keywords: providerSearchKeywords(provider.provider, provider.displayName),
      detail: provider.provider,
      provider,
    }));
}
