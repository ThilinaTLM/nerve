import { chmod, mkdir, rename } from "node:fs/promises";
import {
  defaultUserConfiguration,
  type IntegrationsConfig,
  type Settings,
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
  const invalid = results.flatMap((result) =>
    result.status === "rejected"
      ? [result.reason as HomeConfigurationDocumentError]
      : [],
  );
  if (invalid.length) throw new HomeConfigurationInvalidError(invalid);
  return Object.fromEntries(
    documents.map(([id], index) => [
      id,
      (results[index] as PromiseFulfilledResult<unknown>).value,
    ]),
  ) as unknown as UserConfiguration;
}

/**
 * Sets each listed document aside as `<file>.invalid-<time>` and writes its
 * default, after the user chose to reset it. Only the six home documents
 * qualify.
 */
export async function resetHomeConfigurationDocuments(
  paths: StoragePaths,
  selected: readonly string[],
): Promise<void> {
  const known = new Map(
    documentPaths(paths).map(([id, path]) => [path, id] as const),
  );
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  for (const path of selected) {
    const id = known.get(path);
    if (!id) throw new Error(`Not a Nerve configuration document: ${path}`);
    if (await pathExists(path)) await rename(path, `${path}.invalid-${stamp}`);
    await atomicWriteJson(path, defaultUserConfiguration[id], CONFIG_MODE);
  }
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
): Promise<UserConfiguration> {
  const parsed = decodeConfiguration(configuration);
  for (const document of configDocuments(paths, parsed)) {
    if (document.path === paths.permissionsConfigPath) continue;
    await atomicWriteJson(document.path, document.value, CONFIG_MODE);
    await chmod(document.path, CONFIG_MODE).catch(() => undefined);
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

/** Every invalid home document, so the user can reset them in one step. */
export class HomeConfigurationInvalidError extends Error {
  constructor(readonly documents: HomeConfigurationDocumentError[]) {
    super(documents.map((document) => document.message).join("\n"));
    this.name = "HomeConfigurationInvalidError";
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
