import type {
  SandboxCreateAuthRefs,
  SandboxCreateConfigInput,
  SandboxManagerCredentialProfile,
} from "@nervekit/shared";
import { sandboxCreateConfigInputSchema } from "@nervekit/shared";

export function applyCredentialProfiles(
  config: SandboxCreateConfigInput,
  profiles: SandboxManagerCredentialProfile[],
  options: { sandboxId: string; managerHttpBaseUrl: string },
): SandboxCreateConfigInput {
  const next: Record<string, unknown> = structuredClone(config) as Record<
    string,
    unknown
  >;
  for (const profile of profiles) applyProfile(next, profile);
  if (usesKvSecretRefs(next)) injectManagerSecretStore(next, options);
  return sandboxCreateConfigInputSchema.parse(next);
}

export function selectProfiles(
  profiles: SandboxManagerCredentialProfile[],
  refs: SandboxCreateAuthRefs | undefined,
): SandboxManagerCredentialProfile[] {
  if (!refs) return [];
  const ids = new Set(
    [
      refs.mainModelProfileId,
      refs.exploreModelProfileId,
      refs.githubProfileId,
      refs.jiraProfileId,
      refs.confluenceProfileId,
      refs.webProfileId,
    ].filter((id): id is string => Boolean(id)),
  );
  return profiles.filter((profile) => ids.has(profile.profileId));
}

function applyProfile(
  config: Record<string, unknown>,
  profile: SandboxManagerCredentialProfile,
): void {
  if (profile.kind === "model_provider")
    applyModelProviderProfile(config, profile);
  if (profile.kind === "github") applyGithubProfile(config, profile);
  if (profile.kind === "jira" || profile.kind === "confluence")
    applyToolCredentialProfile(config, profile);
  if (profile.kind === "web_provider")
    applyToolCredentialProfile(config, profile, "web");
}

function applyModelProviderProfile(
  config: Record<string, unknown>,
  profile: SandboxManagerCredentialProfile,
): void {
  const providerId = profile.provider;
  if (!providerId) throw new Error("model provider profile requires provider");
  const catalog = ensureObject(config, "modelCatalog");
  const providers = ensureArray(catalog, "providers");
  const existing = providers.find(
    (entry) => isObject(entry) && entry.id === providerId,
  ) as Record<string, unknown> | undefined;
  const providerConfig = {
    ...(existing ?? {}),
    id: providerId,
    ...(profile.displayName ? { displayName: profile.displayName } : {}),
    ...(profile.api ? { api: profile.api } : { builtin: true }),
    ...(profile.baseUrl ? { baseUrl: profile.baseUrl } : {}),
    ...(profile.headers ? { headers: profile.headers } : {}),
    ...(profile.compat ? { compat: profile.compat } : {}),
    ...(profile.credential ? { credential: profile.credential } : {}),
  };
  if (existing) Object.assign(existing, providerConfig);
  else providers.push(providerConfig);
}

function applyGithubProfile(
  config: Record<string, unknown>,
  profile: SandboxManagerCredentialProfile,
): void {
  const github = ensureObject(config, "github");
  github.enabled = true;
  if (profile.credential) github.auth = profile.credential;
  if (profile.provider) github.host = profile.provider;
  if (profile.defaultOwner) github.defaultOwner = profile.defaultOwner;
  if (profile.defaultRepo) github.defaultRepo = profile.defaultRepo;
}

function applyToolCredentialProfile(
  config: Record<string, unknown>,
  profile: SandboxManagerCredentialProfile,
  overrideGroup?: string,
): void {
  const group = overrideGroup ?? profile.kind;
  const tools = ensureObject(config, "tools");
  const groups = ensureObject(tools, "groups");
  const tool = ensureObject(groups, group);
  tool.enabled = true;
  if (profile.provider) tool.provider = profile.provider;
  if (profile.siteUrl) tool.siteUrl = profile.siteUrl;
  if (profile.baseUrl) tool.baseUrl = profile.baseUrl;
  if (profile.email) tool.email = profile.email;
  if (profile.defaultProjectKey)
    tool.defaultProjectKey = profile.defaultProjectKey;
  if (profile.defaultSpaceKey) tool.defaultSpaceKey = profile.defaultSpaceKey;
  if (profile.credential) tool.credential = profile.credential;
}

function injectManagerSecretStore(
  config: Record<string, unknown>,
  options: { sandboxId: string; managerHttpBaseUrl: string },
): void {
  const secretStores = ensureObject(config, "secretStores");
  secretStores.defaultStore = secretStores.defaultStore ?? "manager";
  const stores = ensureObject(secretStores, "stores");
  stores.manager = {
    type: "http_kv",
    endpoint: `${options.managerHttpBaseUrl}/api/sandboxes/${encodeURIComponent(
      options.sandboxId,
    )}/secrets/resolve`,
    response: { valueJsonPointer: "/data/value" },
    auth: {
      type: "bearer",
      token: { file: "/secrets/controller-token" },
    },
  };
}

function usesKvSecretRefs(value: unknown): boolean {
  if (!isObject(value)) return false;
  if ("kv" in value) return true;
  return Object.values(value).some((child) => usesKvSecretRefs(child));
}

function ensureObject(
  parent: Record<string, unknown>,
  key: string,
): Record<string, unknown> {
  const current = parent[key];
  if (isObject(current)) return current;
  const next: Record<string, unknown> = {};
  parent[key] = next;
  return next;
}

function ensureArray(parent: Record<string, unknown>, key: string): unknown[] {
  const current = parent[key];
  if (Array.isArray(current)) return current;
  const next: unknown[] = [];
  parent[key] = next;
  return next;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
