import { join } from "node:path";
import {
  atlassianProfileSchema,
  defaultSettings,
  settingsSchema,
  tavilyProfileSchema,
  type AtlassianProfile,
  type TavilyProfile,
} from "@nervekit/contracts";
import { providerApiKeySecretName } from "../../../domains/auth/pi-ai-credential-store.js";
import { EncryptedFileSecretProvider } from "../../secrets/index.js";
import {
  atomicWriteJson,
  pathExists,
  readJsonFile,
} from "../../storage/json.js";
import { normalizeSettings } from "../../storage/settings-normalization.js";
import { migrationChecksum } from "../checksum.js";
import type { StorageMigration } from "../migration.js";

const markerPath = "migrations/.integration-provider-profiles-v1";
const backupPaths = [
  "config.json",
  "keys/secrets.json.enc",
  "keys/master.key",
  markerPath,
];

type UnknownRecord = Record<string, unknown>;
type LegacyKind = "jira" | "confluence";

type LegacyCandidate = {
  kind: LegacyKind;
  enabled: boolean;
  siteUrl?: string;
  email?: string;
  defaultProjectKey?: string;
  defaultSpaceKey?: string;
  token?: string;
};

type MigrationMarker = {
  migratedAt: string;
  migratedLegacyProviders: string[];
  destinationProviders: string[];
};

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function normalizeAtlassianSiteUrl(value: unknown): string | undefined {
  const raw = optionalString(value);
  if (!raw || /\s/.test(raw)) return undefined;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw)
    ? raw
    : `https://${raw}`;
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

function normalizeEmail(value: unknown): string | undefined {
  const email = optionalString(value)?.toLowerCase();
  return email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : undefined;
}

function candidateFrom(
  kind: LegacyKind,
  value: unknown,
  token: string | undefined,
): LegacyCandidate | undefined {
  const source = record(value);
  const candidate: LegacyCandidate = {
    kind,
    enabled: source.enabled === true,
    siteUrl: normalizeAtlassianSiteUrl(source.siteUrl),
    email: normalizeEmail(source.email),
    token,
    ...(kind === "jira"
      ? { defaultProjectKey: optionalString(source.defaultProjectKey) }
      : { defaultSpaceKey: optionalString(source.defaultSpaceKey) }),
  };
  const meaningful =
    candidate.enabled ||
    Boolean(token) ||
    [
      source.siteUrl,
      source.email,
      source.defaultProjectKey,
      source.defaultSpaceKey,
    ].some((entry) => optionalString(entry));
  return meaningful ? candidate : undefined;
}

function valuesConflict(left?: string, right?: string): boolean {
  return Boolean(left && right && left !== right);
}

export function legacyCandidatesCompatible(
  left: LegacyCandidate,
  right: LegacyCandidate,
): boolean {
  return !(
    valuesConflict(left.siteUrl, right.siteUrl) ||
    valuesConflict(left.email, right.email) ||
    valuesConflict(left.token, right.token)
  );
}

function availableId(base: string, used: Set<string>): string {
  if (!used.has(base)) {
    used.add(base);
    return base;
  }
  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${base}-${suffix}`;
    if (!used.has(candidate)) {
      used.add(candidate);
      return candidate;
    }
  }
}

function profileFromCandidate(
  id: string,
  name: string,
  candidate: LegacyCandidate,
): AtlassianProfile {
  return {
    id,
    name,
    siteUrl: candidate.siteUrl,
    email: candidate.email,
    defaultProjectKey: candidate.defaultProjectKey,
    defaultSpaceKey: candidate.defaultSpaceKey,
  };
}

function existingProfiles(settings: UnknownRecord): {
  atlassian: AtlassianProfile[];
  tavily: TavilyProfile[];
} {
  const providers = record(settings.providers);
  return {
    atlassian: Array.isArray(providers.atlassianProfiles)
      ? providers.atlassianProfiles.flatMap((value) => {
          const parsed = atlassianProfileSchema.safeParse(value);
          return parsed.success ? [parsed.data] : [];
        })
      : [],
    tavily: Array.isArray(providers.tavilyProfiles)
      ? providers.tavilyProfiles.flatMap((value) => {
          const parsed = tavilyProfileSchema.safeParse(value);
          return parsed.success ? [parsed.data] : [];
        })
      : [],
  };
}

async function copyCredential(
  secrets: EncryptedFileSecretProvider,
  source: string,
  destination: string,
  expected: string | undefined,
): Promise<boolean> {
  if (!expected) return false;
  await secrets.set(providerApiKeySecretName(destination), expected);
  const copied = await secrets.get(providerApiKeySecretName(destination));
  if (copied !== expected) {
    throw new Error(
      `Credential migration verification failed for '${destination}'.`,
    );
  }
  await secrets.delete(providerApiKeySecretName(source));
  return true;
}

export const migration0010: StorageMigration = {
  id: "0010-integration-provider-profiles",
  description: "Migrate integration credentials into named provider profiles",
  checksum: migrationChecksum(
    "0010-integration-provider-profiles|v1|Migrate integration credentials into named provider profiles",
  ),
  async detect(context) {
    return (await pathExists(join(context.paths.home, markerPath)))
      ? "current"
      : "pending";
  },
  async backup() {
    return { paths: backupPaths };
  },
  async up(context) {
    const raw = (await pathExists(context.paths.configPath))
      ? record(await readJsonFile<unknown>(context.paths.configPath))
      : { ...defaultSettings };
    const tools = record(raw.tools);
    const profiles = existingProfiles(raw);
    const usedAtlassianIds = new Set(profiles.atlassian.map(({ id }) => id));
    const usedTavilyIds = new Set(profiles.tavily.map(({ id }) => id));
    const secrets = new EncryptedFileSecretProvider(context.paths.home);
    const jiraToken = await secrets.get(providerApiKeySecretName("jira"));
    const confluenceToken = await secrets.get(
      providerApiKeySecretName("confluence"),
    );
    const jira = candidateFrom("jira", tools.jira, jiraToken);
    const confluence = candidateFrom(
      "confluence",
      tools.confluence,
      confluenceToken,
    );
    const migratedLegacyProviders: string[] = [];
    const destinationProviders: string[] = [];
    let jiraProfileId = optionalString(record(tools.jira).profileId);
    let confluenceProfileId = optionalString(
      record(tools.confluence).profileId,
    );
    let jiraCredentialReady = false;
    let confluenceCredentialReady = false;

    if (jira && confluence && legacyCandidatesCompatible(jira, confluence)) {
      const id = availableId("legacy-atlassian-default", usedAtlassianIds);
      const combined: LegacyCandidate = {
        kind: "jira",
        enabled: jira.enabled || confluence.enabled,
        siteUrl: jira.siteUrl ?? confluence.siteUrl,
        email: jira.email ?? confluence.email,
        token: jira.token ?? confluence.token,
        defaultProjectKey: jira.defaultProjectKey,
        defaultSpaceKey: confluence.defaultSpaceKey,
      };
      profiles.atlassian.push(profileFromCandidate(id, "Default", combined));
      jiraProfileId = id;
      confluenceProfileId = id;
      const credentialReady = await copyCredential(
        secrets,
        jira.token ? "jira" : "confluence",
        `atlassian:${id}`,
        combined.token,
      );
      jiraCredentialReady = credentialReady;
      confluenceCredentialReady = credentialReady;
      if (jira.token && confluence.token) {
        await secrets.delete(providerApiKeySecretName("confluence"));
      }
      if (jira.token) migratedLegacyProviders.push("jira");
      if (confluence.token) migratedLegacyProviders.push("confluence");
      if (combined.token) destinationProviders.push(`atlassian:${id}`);
    } else {
      if (jira) {
        const id = availableId("legacy-atlassian-jira", usedAtlassianIds);
        profiles.atlassian.push(profileFromCandidate(id, "Jira", jira));
        jiraProfileId = id;
        jiraCredentialReady = await copyCredential(
          secrets,
          "jira",
          `atlassian:${id}`,
          jira.token,
        );
        if (jira.token) {
          migratedLegacyProviders.push("jira");
          destinationProviders.push(`atlassian:${id}`);
        }
      }
      if (confluence) {
        const id = availableId("legacy-atlassian-confluence", usedAtlassianIds);
        profiles.atlassian.push(
          profileFromCandidate(id, "Confluence", confluence),
        );
        confluenceProfileId = id;
        confluenceCredentialReady = await copyCredential(
          secrets,
          "confluence",
          `atlassian:${id}`,
          confluence.token,
        );
        if (confluence.token) {
          migratedLegacyProviders.push("confluence");
          destinationProviders.push(`atlassian:${id}`);
        }
      }
    }

    const legacyTavilyToken = await secrets.get(
      providerApiKeySecretName("tavily"),
    );
    let tavilyProfileId = optionalString(record(tools.web).tavilyProfileId);
    if (legacyTavilyToken) {
      tavilyProfileId = availableId("legacy-tavily-default", usedTavilyIds);
      profiles.tavily.push({ id: tavilyProfileId, name: "Default" });
      await copyCredential(
        secrets,
        "tavily",
        `tavily:${tavilyProfileId}`,
        legacyTavilyToken,
      );
      migratedLegacyProviders.push("tavily");
      destinationProviders.push(`tavily:${tavilyProfileId}`);
    }

    const jiraSource = record(tools.jira);
    const confluenceSource = record(tools.confluence);
    const profileIsComplete = (profileId: string | undefined) => {
      const profile = profiles.atlassian.find(({ id }) => id === profileId);
      return Boolean(profile?.siteUrl && profile.email);
    };
    if (jiraProfileId && !jiraCredentialReady) {
      jiraCredentialReady = Boolean(
        await secrets.get(
          providerApiKeySecretName(`atlassian:${jiraProfileId}`),
        ),
      );
    }
    if (confluenceProfileId && !confluenceCredentialReady) {
      confluenceCredentialReady = Boolean(
        await secrets.get(
          providerApiKeySecretName(`atlassian:${confluenceProfileId}`),
        ),
      );
    }
    const nextRaw = {
      ...raw,
      providers: {
        atlassianProfiles: profiles.atlassian,
        tavilyProfiles: profiles.tavily,
      },
      tools: {
        ...tools,
        jira: {
          enabled: Boolean(
            jiraSource.enabled &&
            profileIsComplete(jiraProfileId) &&
            jiraCredentialReady,
          ),
          profileId: jiraProfileId,
        },
        confluence: {
          enabled: Boolean(
            confluenceSource.enabled &&
            profileIsComplete(confluenceProfileId) &&
            confluenceCredentialReady,
          ),
          profileId: confluenceProfileId,
        },
        web: { ...record(tools.web), tavilyProfileId },
      },
    };
    const normalized = normalizeSettings(nextRaw).settings;
    await atomicWriteJson(context.paths.configPath, normalized, 0o600);
    await atomicWriteJson(
      join(context.paths.home, markerPath),
      {
        migratedAt: context.now().toISOString(),
        migratedLegacyProviders,
        destinationProviders,
      } satisfies MigrationMarker,
      0o600,
    );
  },
  async verify(context) {
    const marker = await readJsonFile<MigrationMarker>(
      join(context.paths.home, markerPath),
    );
    settingsSchema.parse(await readJsonFile<unknown>(context.paths.configPath));
    const secrets = new EncryptedFileSecretProvider(context.paths.home);
    for (const source of marker.migratedLegacyProviders) {
      if (await secrets.get(providerApiKeySecretName(source))) {
        throw new Error(
          `Legacy credential '${source}' remains after migration.`,
        );
      }
    }
    for (const destination of marker.destinationProviders) {
      if (!(await secrets.get(providerApiKeySecretName(destination)))) {
        throw new Error(
          `Migrated credential '${destination}' is missing after migration.`,
        );
      }
    }
  },
};
