import { chmod, copyFile, mkdir, open, rename, rm } from "node:fs/promises";
import { basename, join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import {
  defaultUserConfiguration,
  type IntegrationsConfig,
  type Settings,
  type SettingsHealth,
  settingsSchema,
  type UserConfiguration,
  integrationsConfigSchema,
} from "@nervekit/contracts/settings";
import type { StoragePaths } from "../storage-bootstrap/paths.js";
import {
  atomicWriteJson,
  pathExists,
  readJsonFile,
} from "../storage-bootstrap/json.js";
import { mergePreservingUnknown } from "./merge.js";
import {
  HOME_CONFIGURATION_CODECS,
  type HomeConfigurationDocumentId,
} from "./home-configuration-codecs.js";

const CONFIG_MODE = 0o600;
// A repaired file must be explicitly reloaded before cached defaults can be saved.
const invalidDocuments = new Map<string, SettingsHealth["invalid"][number]>();

export function isHomeConfigurationInvalid(path: string): boolean {
  return invalidDocuments.has(path);
}

export function assertHomeConfigurationPathWritable(path: string): void {
  const problem = invalidDocuments.get(path);
  if (problem)
    throw new Error(
      `Cannot save invalid ${problem.id} settings: ${problem.reason}. Reset to defaults or fix the file and Reload first.`,
    );
}

export async function reloadHomeConfigurationDocument(
  paths: StoragePaths,
  id: HomeConfigurationDocumentId,
): Promise<void> {
  const path = documentPaths(paths).find(([key]) => key === id)?.[1];
  if (!path) throw new Error(`Not a Nerve configuration document: ${id}`);
  try {
    await readConfigDocument(id, path);
    invalidDocuments.delete(path);
  } catch (error) {
    if (!(error instanceof HomeConfigurationDocumentError)) throw error;
    invalidDocuments.set(path, { id, path, reason: error.reason });
  }
}

/**
 * A successful framework conversion can repair documents rejected by the
 * pre-migration bind-settings read. Revalidate only cached failures; leave
 * unreadable sources in recovery. Never use this for a no-op migration check
 * or ordinary reads, where manual repairs still require explicit Reload.
 */
export async function revalidateHomeConfigurationAfterMigration(
  paths: StoragePaths,
): Promise<void> {
  for (const [id, path] of documentPaths(paths)) {
    if (invalidDocuments.has(path))
      await reloadHomeConfigurationDocument(paths, id);
  }
}

export async function initializeHomeConfiguration(
  paths: StoragePaths,
): Promise<UserConfiguration> {
  await mkdir(paths.configPath, { recursive: true, mode: 0o755 });
  const documents = configDocuments(paths, defaultUserConfiguration);
  for (const document of documents) {
    if (!(await pathExists(document.path))) {
      await atomicWriteJson(document.path, document.value, CONFIG_MODE);
    }
    await chmod(document.path, CONFIG_MODE).catch(() => undefined);
  }
  return readHomeConfiguration(paths);
}

export async function readHomeConfiguration(
  paths: StoragePaths,
): Promise<UserConfiguration> {
  const documents = documentPaths(paths);
  const results = await Promise.allSettled(
    documents.map(([id, path]) => readConfigDocument(id, path)),
  );
  for (const [index, [id, path]] of documents.entries()) {
    const result = results[index];
    if (result.status === "rejected") {
      const error = result.reason as HomeConfigurationDocumentError;
      invalidDocuments.set(path, { id, path, reason: error.reason });
    }
  }
  return Object.fromEntries(
    documents.map(([id, path], index) => [
      id,
      results[index].status === "fulfilled" && !invalidDocuments.has(path)
        ? (results[index] as PromiseFulfilledResult<unknown>).value
        : structuredClone(defaultUserConfiguration[id]),
    ]),
  ) as unknown as UserConfiguration;
}

/** Read-only health check: invalid source bytes are never rewritten by reads. */
export async function readSettingsHealth(
  paths: StoragePaths,
): Promise<SettingsHealth> {
  const invalid: SettingsHealth["invalid"] = [];
  for (const [id, path] of documentPaths(paths)) {
    try {
      await readConfigDocument(id, path);
    } catch (error) {
      if (!(error instanceof HomeConfigurationDocumentError)) throw error;
      invalidDocuments.set(path, { id, path, reason: error.reason });
    }
    const problem = invalidDocuments.get(path);
    if (problem) invalid.push(problem);
  }
  return { invalid };
}

export async function assertHomeConfigurationWritable(
  paths: StoragePaths,
  ids: readonly HomeConfigurationDocumentId[],
): Promise<void> {
  const invalid = (await readSettingsHealth(paths)).invalid.filter((item) =>
    ids.includes(item.id),
  );
  if (invalid.length)
    throw new Error(
      `Cannot save invalid settings: ${invalid.map((item) => `${item.id}: ${item.reason}`).join("; ")}. Reset to defaults or fix the file and Reload first.`,
    );
}

/** Explicit reset preserves the original permanently, outside migration scratch. */
export async function resetHomeConfigurationDocument(
  paths: StoragePaths,
  id: HomeConfigurationDocumentId,
): Promise<void> {
  const path = documentPaths(paths).find(([key]) => key === id)?.[1];
  if (!path) throw new Error(`Not a Nerve configuration document: ${id}`);
  const problem = (await readSettingsHealth(paths)).invalid.find(
    (item) => item.id === id,
  );
  if (!problem)
    throw new Error(`${id} settings are no longer invalid. Reload first.`);
  const root = join(paths.home, "quarantine", "settings");
  await mkdir(root, { recursive: true, mode: 0o700 });
  const hash = createHash("sha256")
    .update(randomUUID())
    .digest("hex")
    .slice(0, 12);
  const entry = join(root, `configuration-${id}-${hash}`);
  // Exclusive entry creation prevents collisions from overwriting quarantine.
  await mkdir(entry, { mode: 0o700 });
  const payload = join(entry, "payload");
  await mkdir(payload, { mode: 0o700 });
  await atomicWriteJson(
    join(entry, "reason.json"),
    {
      kind: "configuration",
      id: path,
      title: `${id}.json`,
      reason: problem.reason,
      originalPath: path,
      quarantinedAt: new Date().toISOString(),
    },
    CONFIG_MODE,
  );
  if (await pathExists(path)) {
    const target = join(payload, basename(path));
    try {
      await rename(path, target);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EXDEV") throw error;
      await copyFile(path, target);
      const handle = await open(target, "r+");
      try {
        await handle.sync();
      } finally {
        await handle.close();
      }
      await rm(path);
    }
  }
  await atomicWriteJson(path, defaultUserConfiguration[id], CONFIG_MODE);
  invalidDocuments.delete(path);
}

function documentPaths(
  paths: StoragePaths,
): Array<[HomeConfigurationDocumentId, string]> {
  return [
    ["daemon", paths.daemonConfigPath],
    ["harness", paths.harnessConfigPath],
    ["ui", paths.uiConfigPath],
    ["permissions", paths.permissionsConfigPath],
    ["providers", paths.providersConfigPath],
    ["integrations", paths.integrationsConfigPath],
  ];
}

export async function writeHomeConfiguration(
  paths: StoragePaths,
  configuration: UserConfiguration,
  touched: readonly HomeConfigurationDocumentId[] = [
    "daemon",
    "harness",
    "ui",
    "providers",
    "integrations",
  ],
): Promise<UserConfiguration> {
  const parsed = decodeConfiguration(configuration);
  const current = await readHomeConfiguration(paths);
  const changed = documentPaths(paths).filter(
    ([id]) =>
      id !== "permissions" &&
      touched.includes(id) &&
      !isDeepStrictEqual(current[id], parsed[id]),
  );
  // Preflight all documents before the first write, so a rejected save is atomic
  // with respect to invalid-file protection.
  await assertHomeConfigurationWritable(paths, touched);
  for (const [id, path] of changed) {
    await atomicWriteJson(path, parsed[id], CONFIG_MODE);
    await chmod(path, CONFIG_MODE).catch(() => undefined);
  }
  return parsed;
}

export class HomeConfigurationDocumentError extends Error {
  constructor(
    readonly documentId: HomeConfigurationDocumentId,
    readonly path: string,
    cause: unknown,
  ) {
    super(`Nerve ${documentId} configuration at ${path} is invalid.`, {
      cause,
    });
    this.name = "HomeConfigurationDocumentError";
  }

  /** One line for the user, e.g. the JSON syntax error or first schema issue. */
  get reason(): string {
    const cause = this.cause as
      | (Error & {
          code?: string;
          issues?: { path: unknown[]; message: string }[];
        })
      | undefined;
    if (cause?.code === "ENOENT") return "The file is missing";
    const issue = cause?.issues?.[0];
    if (issue)
      return `${issue.path.length ? `${issue.path.join(".")}: ` : ""}${issue.message}`;
    return cause instanceof Error ? cause.message : "The file is invalid";
  }
}

async function readConfigDocument<K extends HomeConfigurationDocumentId>(
  documentId: K,
  path: string,
): Promise<UserConfiguration[K]> {
  try {
    return HOME_CONFIGURATION_CODECS[documentId].decode(
      await readJsonFile<unknown>(path),
    ) as UserConfiguration[K];
  } catch (cause) {
    throw new HomeConfigurationDocumentError(documentId, path, cause);
  }
}

function decodeConfiguration(
  configuration: UserConfiguration,
): UserConfiguration {
  return {
    daemon: HOME_CONFIGURATION_CODECS.daemon.decode(configuration.daemon),
    harness: HOME_CONFIGURATION_CODECS.harness.decode(configuration.harness),
    ui: HOME_CONFIGURATION_CODECS.ui.decode(configuration.ui),
    permissions: HOME_CONFIGURATION_CODECS.permissions.decode(
      configuration.permissions,
    ),
    providers: HOME_CONFIGURATION_CODECS.providers.decode(
      configuration.providers,
    ),
    integrations: HOME_CONFIGURATION_CODECS.integrations.decode(
      configuration.integrations,
    ),
  };
}

function configDocuments(
  paths: StoragePaths,
  configuration: UserConfiguration,
): Array<{ path: string; value: unknown }> {
  return [
    { path: paths.daemonConfigPath, value: configuration.daemon },
    { path: paths.harnessConfigPath, value: configuration.harness },
    { path: paths.uiConfigPath, value: configuration.ui },
    { path: paths.permissionsConfigPath, value: configuration.permissions },
    { path: paths.providersConfigPath, value: configuration.providers },
    { path: paths.integrationsConfigPath, value: configuration.integrations },
  ];
}

/** Runtime/UI projection assembled from the six authoritative documents. */
export function settingsFromConfiguration(
  configuration: UserConfiguration,
): Settings {
  const { daemon, harness, ui, integrations } = configuration;
  return settingsSchema.parse({
    defaultPermissionRuleSetId: harness.defaults.permissionRuleSetId,
    defaultModel: harness.defaults.model,
    defaultThinkingLevel: harness.defaults.thinkingLevel,
    rememberLastAgentSelection: harness.rememberLastSelection,
    lastAgentSelection: harness.lastSelection,
    application: {
      network: daemon.network,
      diagnostics: daemon.diagnostics,
      daemon: daemon.process,
      electron: daemon.electron,
    },
    ui: ui.appearance,
    desktop: ui.desktop,
    notifications: ui.notifications,
    transcription: ui.transcription,
    compaction: harness.compaction,
    logging: daemon.logging,
    retry: harness.retry,
    runtime: harness.execution,
    permissions: { exceptions: [] },
    providers: {
      atlassianProfiles: integrations.profiles.atlassian.map((profile) => ({
        id: profile.id,
        name: profile.name,
        siteUrl: profile.siteUrl,
        email: profile.email,
        defaultProjectKey: profile.defaultProjectKey,
        defaultSpaceKey: profile.defaultSpaceKey,
      })),
      tavilyProfiles: integrations.profiles.tavily.map((profile) => ({
        id: profile.id,
        name: profile.name,
      })),
    },
    tools: {
      disabled: harness.tools.disabled,
      bash: harness.tools.bash,
      jira: integrations.tools.jira,
      confluence: integrations.tools.confluence,
      web: integrations.tools.web,
      imageExplanation: harness.tools.imageExplanation,
      imageGeneration: harness.tools.imageGeneration,
      kroki: harness.tools.kroki,
    },
    skills: harness.skills,
    scopedModels: harness.scopedModels,
  });
}

export function configurationWithSettings(
  current: UserConfiguration,
  settings: Settings,
): UserConfiguration {
  const parsed = settingsSchema.parse(settings);
  const integrations = integrationsFromSettings(current.integrations, parsed);
  return decodeConfiguration(
    preserveConfigurationExtensions(current, {
      ...current,
      daemon: {
        version: 1,
        network: parsed.application.network,
        diagnostics: {
          loggingEnabled: parsed.application.diagnostics.loggingEnabled,
          performanceEnabled:
            parsed.application.diagnostics.performanceEnabled ?? false,
        },
        process: parsed.application.daemon,
        logging: parsed.logging,
        electron: parsed.application.electron,
      },
      harness: {
        version: 3,
        defaults: {
          // New agents always start in coding mode; planning is a per-agent choice.
          mode: "coding",
          permissionRuleSetId: parsed.defaultPermissionRuleSetId,
          model: parsed.defaultModel,
          thinkingLevel: parsed.defaultThinkingLevel,
        },
        rememberLastSelection: parsed.rememberLastAgentSelection,
        lastSelection: parsed.lastAgentSelection,
        compaction: parsed.compaction,
        retry: parsed.retry,
        execution: parsed.runtime,
        tools: {
          disabled: parsed.tools.disabled,
          bash: parsed.tools.bash,
          imageExplanation: parsed.tools.imageExplanation,
          imageGeneration: parsed.tools.imageGeneration,
          kroki: parsed.tools.kroki,
        },
        skills: parsed.skills,
        scopedModels: parsed.scopedModels,
      },
      ui: {
        version: 1,
        appearance: parsed.ui,
        desktop: parsed.desktop,
        notifications: parsed.notifications,
        transcription: parsed.transcription,
      },
      permissions: current.permissions,
      integrations,
    }),
  );
}

function preserveConfigurationExtensions(
  current: UserConfiguration,
  next: UserConfiguration,
): UserConfiguration {
  return Object.fromEntries(
    (Object.keys(next) as HomeConfigurationDocumentId[]).map((documentId) => [
      documentId,
      mergePreservingUnknown(current[documentId], next[documentId]),
    ]),
  ) as unknown as UserConfiguration;
}

function integrationsFromSettings(
  current: IntegrationsConfig,
  settings: Settings,
): IntegrationsConfig {
  const atlassianCredentials = new Map(
    current.profiles.atlassian.map((profile) => [
      profile.id,
      profile.credential,
    ]),
  );
  const tavilyCredentials = new Map(
    current.profiles.tavily.map((profile) => [profile.id, profile.credential]),
  );
  return integrationsConfigSchema.parse({
    version: 1,
    profiles: {
      atlassian: settings.providers.atlassianProfiles.map((profile) => ({
        ...profile,
        credential:
          atlassianCredentials.get(profile.id) ?? `atlassian:${profile.id}`,
      })),
      tavily: settings.providers.tavilyProfiles.map((profile) => ({
        ...profile,
        credential: tavilyCredentials.get(profile.id) ?? `tavily:${profile.id}`,
      })),
    },
    tools: {
      jira: settings.tools.jira,
      confluence: settings.tools.confluence,
      web: settings.tools.web,
    },
  });
}
