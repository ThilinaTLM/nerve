import { chmod, mkdir } from "node:fs/promises";
import {
  defaultPermissionsConfig,
  defaultUserConfiguration,
  type IntegrationsConfig,
  type Settings,
  settingsSchema,
  type UserConfiguration,
  userConfigurationSchema,
  daemonConfigSchema,
  harnessConfigSchema,
  integrationsConfigSchema,
  permissionsConfigSchema,
  providersConfigSchema,
  uiConfigSchema,
} from "@nervekit/contracts/settings";
import type { StoragePaths } from "../storage-bootstrap/paths.js";
import {
  atomicWriteJson,
  pathExists,
  readJsonFile,
} from "../storage-bootstrap/json.js";

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
  const [daemon, harness, ui, permissions, providers, integrations] =
    await Promise.all([
      readConfig(paths.daemonConfigPath, daemonConfigSchema),
      readConfig(paths.harnessConfigPath, harnessConfigSchema),
      readConfig(paths.uiConfigPath, uiConfigSchema),
      readPermissionConfig(paths.permissionsConfigPath),
      readConfig(paths.providersConfigPath, providersConfigSchema),
      readConfig(paths.integrationsConfigPath, integrationsConfigSchema),
    ]);
  return userConfigurationSchema.parse({
    daemon,
    harness,
    ui,
    permissions,
    providers,
    integrations,
  });
}

export async function writeHomeConfiguration(
  paths: StoragePaths,
  configuration: UserConfiguration,
): Promise<UserConfiguration> {
  const parsed = userConfigurationSchema.parse(configuration);
  for (const document of configDocuments(paths, parsed)) {
    if (document.path === paths.permissionsConfigPath) continue;
    await atomicWriteJson(document.path, document.value, CONFIG_MODE);
    await chmod(document.path, CONFIG_MODE).catch(() => undefined);
  }
  return parsed;
}

async function readConfig<T>(
  path: string,
  schema: { parse(value: unknown): T },
): Promise<T> {
  try {
    return schema.parse(await readJsonFile<unknown>(path));
  } catch (cause) {
    throw new Error(`Nerve configuration at ${path} is invalid.`, { cause });
  }
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
    defaultMode: harness.defaults.mode,
    defaultPermissionLevel: harness.defaults.permissionLevel,
    defaultPermissionRuleSetId: harness.defaults.permissionRuleSetId,
    defaultModel: harness.defaults.model,
    defaultThinkingLevel: harness.defaults.thinkingLevel,
    rememberLastAgentSelection: harness.rememberLastSelection,
    lastAgentSelection: harness.lastSelection,
    exploreAgent: harness.exploreAgent,
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
  return userConfigurationSchema.parse({
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
      version: 1,
      defaults: {
        mode: parsed.defaultMode,
        permissionLevel: parsed.defaultPermissionLevel,
        permissionRuleSetId: parsed.defaultPermissionRuleSetId,
        model: parsed.defaultModel,
        thinkingLevel: parsed.defaultThinkingLevel,
      },
      rememberLastSelection: parsed.rememberLastAgentSelection,
      lastSelection: parsed.lastAgentSelection,
      exploreAgent: parsed.exploreAgent,
      compaction: parsed.compaction,
      retry: parsed.retry,
      execution: parsed.runtime,
      tools: {
        disabled: parsed.tools.disabled,
        bash: parsed.tools.bash,
        imageExplanation: parsed.tools.imageExplanation,
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
  });
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

async function readPermissionConfig(path: string) {
  try {
    return permissionsConfigSchema.parse(await readJsonFile<unknown>(path));
  } catch {
    // Permission sources are validated and diagnosed by PermissionPolicyService.
    // An invalid overlay must not prevent Nerve from starting.
    return defaultPermissionsConfig;
  }
}
