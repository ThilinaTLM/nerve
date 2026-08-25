import { rm } from "node:fs/promises";
import {
  type AtlassianProfile,
  providerCatalogSchema,
  settingsSchema,
} from "@nervekit/contracts";
import {
  providerApiKeySecretName,
  providerOAuthSecretName,
} from "../../../domains/auth/pi-ai-credential-store.js";
import { EncryptedFileSecretProvider } from "../../secrets/index.js";
import {
  LEGACY_IMPORT_ENVELOPE_PATH,
  LEGACY_IMPORT_MARKER_PATH,
  legacyImportEnvelopePath,
  legacyImportMarkerPath,
  readLegacyImportEnvelope,
  type LegacyImportMarker,
} from "../../storage/legacy-import-envelope.js";
import {
  atomicWriteJson,
  pathExists,
  readJsonFile,
} from "../../storage/json.js";
import { normalizeSettings } from "../legacy/settings-normalization.js";
import { migrationChecksum } from "../checksum.js";
import type { StorageMigration } from "../migration.js";

interface ImportMarker extends LegacyImportMarker {
  importedCredentialNames: string[];
}

type UnknownRecord = Record<string, unknown>;

export const migration0011: StorageMigration = {
  id: "0011-import-legacy-portable-state",
  description: "Import staged portable state from a retained legacy home",
  checksum: migrationChecksum(
    "0011-import-legacy-portable-state|v1|Import staged portable state from a retained legacy home",
  ),
  async detect(context) {
    return (await pathExists(legacyImportEnvelopePath(context.paths.home)))
      ? "pending"
      : "current";
  },
  async backup() {
    return {
      paths: [
        LEGACY_IMPORT_ENVELOPE_PATH,
        LEGACY_IMPORT_MARKER_PATH,
        "config.json",
        "providers.json",
        "keys/master.key",
        "keys/secrets.json.enc",
      ],
    };
  },
  async up(context) {
    const envelope = await readLegacyImportEnvelope(context.paths.home);
    const importedNames = new Set<string>();
    const secrets = new EncryptedFileSecretProvider(context.paths.home);
    for (const credential of envelope.credentials) {
      await secrets.set(credential.name, credential.value);
      importedNames.add(credential.name);
    }

    if (envelope.settings) {
      const legacyTools = record(envelope.settings.tools);
      const normalized = normalizeSettings(envelope.settings).settings;
      const integration = await importIntegrationProfiles(
        normalized,
        legacyTools,
        secrets,
        importedNames,
      );
      await atomicWriteJson(
        context.paths.configPath,
        settingsSchema.parse(integration),
        0o600,
      );
    }

    if (envelope.providerCatalog) {
      await atomicWriteJson(
        context.paths.providersPath,
        providerCatalogSchema.parse(envelope.providerCatalog),
        0o600,
      );
    }

    const marker: ImportMarker = {
      importedAt: context.now().toISOString(),
      settingsStatus: envelope.settings ? "imported" : "none",
      providerCatalogStatus: envelope.providerCatalog ? "imported" : "none",
      importedCustomProviderCount:
        envelope.providerCatalog?.providers.length ?? 0,
      importedCustomModelCount: envelope.providerCatalog?.models.length ?? 0,
      importedCredentialCount: envelope.credentials.length,
      credentialStatus:
        envelope.credentialStatus === "failed"
          ? "failed"
          : envelope.credentials.length > 0
            ? "imported"
            : "none",
      importedCredentialNames: [...importedNames].sort(),
    };
    await atomicWriteJson(
      legacyImportMarkerPath(context.paths.home),
      marker,
      0o600,
    );
  },
  async verify(context) {
    const envelopePath = legacyImportEnvelopePath(context.paths.home);
    if (!(await pathExists(envelopePath))) return;
    const marker = await readJsonFile<ImportMarker>(
      legacyImportMarkerPath(context.paths.home),
    );
    settingsSchema.parse(await readJsonFile<unknown>(context.paths.configPath));
    if (marker.providerCatalogStatus === "imported") {
      providerCatalogSchema.parse(
        await readJsonFile<unknown>(context.paths.providersPath),
      );
    }
    const secrets = new EncryptedFileSecretProvider(context.paths.home);
    for (const name of marker.importedCredentialNames) {
      if ((await secrets.get(name)) === undefined) {
        throw new Error(`Imported credential '${name}' is missing.`);
      }
    }
    await rm(envelopePath);
  },
};

async function importIntegrationProfiles(
  settings: ReturnType<typeof normalizeSettings>["settings"],
  legacyTools: UnknownRecord,
  secrets: EncryptedFileSecretProvider,
  importedNames: Set<string>,
): Promise<unknown> {
  const profiles = [...settings.providers.atlassianProfiles];
  const usedIds = new Set(profiles.map(({ id }) => id));
  const jira = integrationCandidate(record(legacyTools.jira));
  const confluence = integrationCandidate(record(legacyTools.confluence));
  jira.hasCredential = await hasProviderCredential(secrets, "jira");
  confluence.hasCredential = await hasProviderCredential(secrets, "confluence");
  jira.present ||= jira.hasCredential;
  confluence.present ||= confluence.hasCredential;
  let jiraProfileId = settings.tools.jira.profileId;
  let confluenceProfileId = settings.tools.confluence.profileId;

  if (
    jira.present &&
    confluence.present &&
    compatible(jira, confluence) &&
    !(jira.hasCredential && confluence.hasCredential)
  ) {
    const id = availableId("legacy-atlassian-default", usedIds);
    profiles.push({
      id,
      name: "Default",
      siteUrl: jira.siteUrl ?? confluence.siteUrl,
      email: jira.email ?? confluence.email,
      defaultProjectKey: jira.defaultProjectKey,
      defaultSpaceKey: confluence.defaultSpaceKey,
    });
    jiraProfileId = id;
    confluenceProfileId = id;
    await moveCredentials(
      secrets,
      jira.hasCredential ? "jira" : "confluence",
      `atlassian:${id}`,
      importedNames,
    );
    if (jira.hasCredential && confluence.hasCredential) {
      await deleteProviderCredentials(secrets, "confluence", importedNames);
    }
  } else {
    if (jira.present) {
      const id = availableId("legacy-atlassian-jira", usedIds);
      profiles.push(profile("Jira", id, jira, "jira"));
      jiraProfileId = id;
      await moveCredentials(secrets, "jira", `atlassian:${id}`, importedNames);
    }
    if (confluence.present) {
      const id = availableId("legacy-atlassian-confluence", usedIds);
      profiles.push(profile("Confluence", id, confluence, "confluence"));
      confluenceProfileId = id;
      await moveCredentials(
        secrets,
        "confluence",
        `atlassian:${id}`,
        importedNames,
      );
    }
  }

  const tavilyProfiles = [...settings.providers.tavilyProfiles];
  let tavilyProfileId = settings.tools.web.tavilyProfileId;
  if (await hasProviderCredential(secrets, "tavily")) {
    const ids = new Set(tavilyProfiles.map(({ id }) => id));
    tavilyProfileId = availableId("legacy-tavily-default", ids);
    tavilyProfiles.push({ id: tavilyProfileId, name: "Default" });
    await moveCredentials(
      secrets,
      "tavily",
      `tavily:${tavilyProfileId}`,
      importedNames,
    );
  }

  const profileComplete = (id: string | undefined) => {
    const item = profiles.find((candidate) => candidate.id === id);
    return Boolean(item?.siteUrl && item.email);
  };
  return {
    ...settings,
    providers: { atlassianProfiles: profiles, tavilyProfiles },
    tools: {
      ...settings.tools,
      jira: {
        enabled:
          jira.enabled &&
          profileComplete(jiraProfileId) &&
          (await hasProviderCredential(secrets, `atlassian:${jiraProfileId}`)),
        profileId: jiraProfileId,
      },
      confluence: {
        enabled:
          confluence.enabled &&
          profileComplete(confluenceProfileId) &&
          (await hasProviderCredential(
            secrets,
            `atlassian:${confluenceProfileId}`,
          )),
        profileId: confluenceProfileId,
      },
      web: { ...settings.tools.web, tavilyProfileId },
    },
  };
}

interface IntegrationCandidate {
  present: boolean;
  enabled: boolean;
  hasCredential: boolean;
  siteUrl?: string;
  email?: string;
  defaultProjectKey?: string;
  defaultSpaceKey?: string;
}

function integrationCandidate(source: UnknownRecord): IntegrationCandidate {
  return {
    present:
      Object.keys(source).length > 0 ||
      source.enabled === true ||
      optionalString(source.siteUrl) !== undefined,
    enabled: source.enabled === true,
    hasCredential: false,
    siteUrl: siteUrl(source.siteUrl),
    email: email(source.email),
    defaultProjectKey: optionalString(source.defaultProjectKey),
    defaultSpaceKey: optionalString(source.defaultSpaceKey),
  };
}

function profile(
  name: string,
  id: string,
  candidate: IntegrationCandidate,
  kind: "jira" | "confluence",
): AtlassianProfile {
  return {
    id,
    name,
    siteUrl: candidate.siteUrl,
    email: candidate.email,
    ...(kind === "jira"
      ? { defaultProjectKey: candidate.defaultProjectKey }
      : { defaultSpaceKey: candidate.defaultSpaceKey }),
  };
}

function compatible(
  left: IntegrationCandidate,
  right: IntegrationCandidate,
): boolean {
  return !(
    (left.siteUrl && right.siteUrl && left.siteUrl !== right.siteUrl) ||
    (left.email && right.email && left.email !== right.email)
  );
}

async function moveCredentials(
  secrets: EncryptedFileSecretProvider,
  source: string,
  destination: string,
  importedNames: Set<string>,
): Promise<void> {
  for (const nameOf of [providerApiKeySecretName, providerOAuthSecretName]) {
    const sourceName = nameOf(source);
    const value = await secrets.get(sourceName);
    if (value === undefined) continue;
    const destinationName = nameOf(destination);
    await secrets.set(destinationName, value);
    await secrets.delete(sourceName);
    importedNames.delete(sourceName);
    importedNames.add(destinationName);
  }
}

async function deleteProviderCredentials(
  secrets: EncryptedFileSecretProvider,
  provider: string,
  importedNames: Set<string>,
): Promise<void> {
  for (const nameOf of [providerApiKeySecretName, providerOAuthSecretName]) {
    const name = nameOf(provider);
    await secrets.delete(name);
    importedNames.delete(name);
  }
}

async function hasProviderCredential(
  secrets: EncryptedFileSecretProvider,
  provider: string,
): Promise<boolean> {
  return Boolean(
    (await secrets.get(providerApiKeySecretName(provider))) ??
    (await secrets.get(providerOAuthSecretName(provider))),
  );
}

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function siteUrl(value: unknown): string | undefined {
  const raw = optionalString(value);
  if (!raw || /\s/.test(raw)) return undefined;
  try {
    const url = new URL(
      /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`,
    );
    if (!["http:", "https:"].includes(url.protocol) || !url.hostname)
      return undefined;
    if (url.search || url.hash) return undefined;
    return `${url.origin}${url.pathname.replace(/\/+$/, "").replace(/\/wiki$/i, "")}`;
  } catch {
    return undefined;
  }
}

function email(value: unknown): string | undefined {
  const candidate = optionalString(value)?.toLowerCase();
  return candidate && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidate)
    ? candidate
    : undefined;
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
