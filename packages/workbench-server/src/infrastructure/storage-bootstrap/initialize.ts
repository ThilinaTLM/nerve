import { chmod, mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { type DaemonStartupProgress } from "@nervekit/contracts/storage";
import {
  defaultSettings,
  NERVE_HOME_MANIFEST,
  type Settings,
  settingsSchema,
  type UpdateSettingsRequest,
  type UserConfiguration,
} from "@nervekit/contracts/settings";
import { version } from "../../app/version.js";
import { atomicWriteJson, pathExists, writeTextFileIfMissing } from "./json.js";
import { resolveDataDir, type StoragePaths, storagePaths } from "./paths.js";
import { CanonicalStore } from "../persistence/canonical-sqlite/index.js";
import {
  configurationWithSettings,
  initializeHomeConfiguration,
  readHomeConfiguration,
  settingsFromConfiguration,
  writeHomeConfiguration,
} from "../configuration/home-configuration.js";
import { inspectNerveHome } from "./state-layout.js";
import { acquireStorageStartupLock } from "./startup-lock.js";
import { EncryptedFileSecretProvider } from "../secrets/index.js";
import { writeStorageMigrationFailureReport } from "../storage-migrations/runner/failure-report.js";
import { legacyReadCompatibilityReleases } from "../storage-migrations/read-compatibility-evidence.js";
import { STORAGE_READ_COMPATIBILITY_ID } from "../storage-migrations/read-compatibility.js";
import {
  createFreshStorage,
  prepareExistingStorage,
} from "../storage-migrations/runner/service.js";

const HOME_DIRECTORIES: Array<[keyof StoragePaths, number]> = [
  ["configPath", 0o755],
  ["secretsPath", 0o700],
  ["dataPath", 0o700],
  ["conversationsPath", 0o700],
  ["reportsPath", 0o700],
  ["imagesPath", 0o700],
  ["plansPath", 0o755],
  ["tasksPath", 0o700],
  ["tlsPath", 0o700],
  ["tmpPath", 0o700],
  ["cachePath", 0o700],
  ["logsPath", 0o700],
  ["crashesPath", 0o700],
  ["migrationsPath", 0o700],
  ["backupsPath", 0o700],
];

export interface StorageInitializationTimings {
  homeInspectionMs: number;
  sqliteMigrationCheckMs: number;
  sqliteMigrationApplyMs: number;
  canonicalOpenMs: number;
}

export interface InitializedStorage {
  paths: StoragePaths;
  configuration: UserConfiguration;
  /** Runtime projection used by the existing application feature APIs. */
  settings: Settings;
  localToken: string;
  canonicalStore: CanonicalStore;
  timings: StorageInitializationTimings;
}

export async function readCurrentSettingsForBootstrap(
  home = resolveDataDir(),
): Promise<Settings> {
  const inspection = await inspectNerveHome(home);
  if (inspection.kind === "current") {
    return settingsFromConfiguration(
      await readHomeConfiguration(storagePaths(home)),
    );
  }
  if (inspection.kind === "unsupported") throw new Error(inspection.reason);
  return defaultSettings;
}

export async function initializeStorage(
  home = resolveDataDir(),
  options: {
    reportStartupProgress?: (progress: DaemonStartupProgress) => void;
  } = {},
): Promise<InitializedStorage> {
  const paths = storagePaths(home);
  options.reportStartupProgress?.({
    type: "nerve.startup.progress",
    phase: "storage-check",
    message: "Checking local storage",
  });

  const startupLock = await acquireStorageStartupLock(home);
  try {
    const homeInspectionStartedAt = performance.now();
    const inspection = await inspectNerveHome(home);
    const homeInspectionMs = Math.round(
      performance.now() - homeInspectionStartedAt,
    );
    if (inspection.kind === "unsupported") throw new Error(inspection.reason);
    const fresh = inspection.kind === "missing" || inspection.kind === "empty";
    await mkdir(paths.home, { recursive: true, mode: 0o700 });
    await chmod(paths.home, 0o700).catch(() => undefined);
    if (fresh) {
      await atomicWriteJson(paths.manifestPath, NERVE_HOME_MANIFEST, 0o600);
    } else if (!(await pathExists(paths.sqlitePath))) {
      throw new Error("Nerve SQLite state at data/nerve.sqlite is missing.");
    }
    for (const [key, mode] of HOME_DIRECTORIES) {
      const directory = paths[key];
      await mkdir(directory, { recursive: true, mode });
      await chmod(directory, mode).catch(() => undefined);
    }

    const configuration = fresh
      ? await initializeHomeConfiguration(paths)
      : await readHomeConfiguration(paths);
    const secretProvider = new EncryptedFileSecretProvider(paths.home);
    if (fresh) {
      await secretProvider.initialize();
    } else {
      await secretProvider.validate();
    }
    const sqliteMigrationCheckStartedAt = performance.now();
    const identity = storageBuildIdentity();
    const reportMigration = (progress: { message: string }) =>
      options.reportStartupProgress?.({
        type: "nerve.startup.progress",
        phase: "storage-migration",
        message: progress.message,
      });
    try {
      if (fresh) {
        reportMigration({ message: "Creating verified storage" });
        await createFreshStorage({ paths, ...identity });
      } else {
        await prepareExistingStorage({
          paths,
          ...identity,
          report: reportMigration,
        });
      }
    } catch (error) {
      await writeStorageMigrationFailureReport(
        paths.migrationFailureReportPath,
        {
          runId: crypto.randomUUID(),
          failedAt: new Date(),
          failure: {
            code:
              error instanceof Error ? error.name : "STORAGE_MIGRATION_ERROR",
            phase: "apply",
            message: error instanceof Error ? error.message : String(error),
            retryable: true,
            appVersion: identity.appVersion,
            ...(identity.gitSha ? { gitSha: identity.gitSha } : {}),
          },
          steps: [],
        },
      ).catch(() => undefined);
      throw error;
    }
    const sqliteMigrationApplyMs = Math.round(
      performance.now() - sqliteMigrationCheckStartedAt,
    );
    const sqliteMigrationCheckMs = 0;
    const canonicalOpenStartedAt = performance.now();
    const canonicalStore = new CanonicalStore(paths.sqlitePath);
    await canonicalStore.initialize();
    const canonicalOpenMs = Math.round(
      performance.now() - canonicalOpenStartedAt,
    );
    const settings = settingsFromConfiguration(configuration);

    if (!(await pathExists(paths.localTokenPath))) {
      if (!fresh) {
        await canonicalStore.close();
        throw new Error("Nerve daemon token is missing.");
      }
      const token = `nt_${Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url")}`;
      await mkdir(dirname(paths.localTokenPath), {
        recursive: true,
        mode: 0o700,
      });
      await writeTextFileIfMissing(paths.localTokenPath, `${token}\n`, 0o600);
    }
    await chmod(paths.localTokenPath, 0o600).catch(() => undefined);
    const localToken = (await readFile(paths.localTokenPath, "utf8")).trim();
    if (!localToken) {
      await canonicalStore.close();
      throw new Error(
        `The local authentication token at ${paths.localTokenPath} is empty.`,
      );
    }

    return {
      paths,
      configuration,
      settings,
      localToken,
      canonicalStore,
      timings: {
        homeInspectionMs,
        sqliteMigrationCheckMs,
        sqliteMigrationApplyMs,
        canonicalOpenMs,
      },
    };
  } finally {
    await startupLock.release();
  }
}

function storageBuildIdentity(): {
  buildId: string;
  readCompatibilityId: string;
  legacyReadCompatibilityReleases: readonly string[];
  appVersion: string;
  gitSha?: string;
} {
  const appVersion = version;
  const gitSha = process.env.NERVE_GIT_SHA?.trim() || undefined;
  const developmentMarker = process.env.NODE_ENV === "production" ? "" : ":dev";
  return {
    appVersion,
    ...(gitSha ? { gitSha } : {}),
    buildId: `${appVersion}:${gitSha ?? "source"}${developmentMarker}`,
    readCompatibilityId: STORAGE_READ_COMPATIBILITY_ID,
    legacyReadCompatibilityReleases: legacyReadCompatibilityReleases(
      STORAGE_READ_COMPATIBILITY_ID,
    ),
  };
}

export async function writeSettings(
  storage: InitializedStorage,
  patch: UpdateSettingsRequest,
): Promise<Settings> {
  const defaultModelPatch =
    patch.defaultModel === null
      ? { defaultModel: undefined }
      : "defaultModel" in patch
        ? { defaultModel: patch.defaultModel }
        : {};
  const lastAgentSelectionPatch = patch.lastAgentSelection
    ? {
        ...patch.lastAgentSelection,
        ...(patch.lastAgentSelection.model === null
          ? { model: undefined }
          : {}),
      }
    : undefined;
  const exploreAgentPatch = patch.exploreAgent
    ? {
        ...patch.exploreAgent,
        ...(patch.exploreAgent.model === null ? { model: undefined } : {}),
      }
    : undefined;
  const asyncSubagentPatch = patch.asyncSubagent
    ? {
        ...patch.asyncSubagent,
        ...(patch.asyncSubagent.model === null ? { model: undefined } : {}),
        ...(patch.asyncSubagent.thinkingLevel === null
          ? { thinkingLevel: undefined }
          : {}),
      }
    : undefined;
  const runtimePatch = patch.runtime
    ? {
        ...patch.runtime,
        ...(patch.runtime.pythonExecutablePath === null
          ? { pythonExecutablePath: undefined }
          : {}),
        ...(patch.runtime.shellPath === null ? { shellPath: undefined } : {}),
      }
    : undefined;
  const bashPatch = patch.tools?.bash
    ? {
        ...patch.tools.bash,
        ...(patch.tools.bash.autoPromotion
          ? {
              autoPromotion: {
                ...storage.settings.tools.bash.autoPromotion,
                ...patch.tools.bash.autoPromotion,
              },
            }
          : {}),
      }
    : undefined;
  const jiraPatch = patch.tools?.jira
    ? {
        ...patch.tools.jira,
        ...(patch.tools.jira.profileId === null
          ? { profileId: undefined }
          : {}),
      }
    : undefined;
  const imageExplanationPatch = patch.tools?.imageExplanation
    ? {
        ...patch.tools.imageExplanation,
        ...(patch.tools.imageExplanation.model === null
          ? { model: undefined }
          : {}),
      }
    : undefined;
  const imageGenerationPatch = patch.tools?.imageGeneration
    ? { ...patch.tools.imageGeneration }
    : undefined;
  const confluencePatch = patch.tools?.confluence
    ? {
        ...patch.tools.confluence,
        ...(patch.tools.confluence.profileId === null
          ? { profileId: undefined }
          : {}),
      }
    : undefined;
  const webPatch = patch.tools?.web
    ? {
        ...patch.tools.web,
        ...(patch.tools.web.tavilyProfileId === null
          ? { tavilyProfileId: undefined }
          : {}),
      }
    : undefined;
  const toolsPatch = patch.tools
    ? {
        ...patch.tools,
        ...(patch.tools.kroki
          ? { kroki: { ...storage.settings.tools.kroki, ...patch.tools.kroki } }
          : {}),
        ...(bashPatch
          ? { bash: { ...storage.settings.tools.bash, ...bashPatch } }
          : {}),
        ...(jiraPatch
          ? { jira: { ...storage.settings.tools.jira, ...jiraPatch } }
          : {}),
        ...(confluencePatch
          ? {
              confluence: {
                ...storage.settings.tools.confluence,
                ...confluencePatch,
              },
            }
          : {}),
        ...(webPatch
          ? { web: { ...storage.settings.tools.web, ...webPatch } }
          : {}),
        ...(imageExplanationPatch
          ? {
              imageExplanation: {
                ...storage.settings.tools.imageExplanation,
                ...imageExplanationPatch,
              },
            }
          : {}),
        ...(imageGenerationPatch
          ? { imageGeneration: imageGenerationPatch }
          : {}),
      }
    : undefined;
  const skillsPatch = patch.skills
    ? {
        ...patch.skills,
        ...(patch.skills.nerve
          ? {
              nerve: {
                ...storage.settings.skills.nerve,
                ...patch.skills.nerve,
              },
            }
          : {}),
        ...(patch.skills.agentBrowser
          ? {
              agentBrowser: {
                ...storage.settings.skills.agentBrowser,
                ...patch.skills.agentBrowser,
              },
            }
          : {}),
      }
    : undefined;
  const next = settingsSchema.parse({
    ...storage.settings,
    ...patch,
    ...defaultModelPatch,
    application: {
      ...storage.settings.application,
      ...(patch.application ?? {}),
      network: {
        ...storage.settings.application.network,
        ...(patch.application?.network ?? {}),
      },
      diagnostics: {
        ...storage.settings.application.diagnostics,
        ...(patch.application?.diagnostics ?? {}),
      },
      daemon: {
        ...storage.settings.application.daemon,
        ...(patch.application?.daemon ?? {}),
      },
      electron: {
        ...storage.settings.application.electron,
        ...(patch.application?.electron ?? {}),
      },
    },
    ui: { ...storage.settings.ui, ...(patch.ui ?? {}) },
    desktop: { ...storage.settings.desktop, ...(patch.desktop ?? {}) },
    notifications: {
      ...storage.settings.notifications,
      ...(patch.notifications ?? {}),
      ...(patch.notifications?.events
        ? {
            events: {
              ...storage.settings.notifications.events,
              ...patch.notifications.events,
            },
          }
        : {}),
    },
    transcription: {
      ...storage.settings.transcription,
      ...(patch.transcription ?? {}),
    },
    lastAgentSelection: {
      ...storage.settings.lastAgentSelection,
      ...(lastAgentSelectionPatch ?? {}),
    },
    exploreAgent: {
      ...storage.settings.exploreAgent,
      ...(exploreAgentPatch ?? {}),
    },
    asyncSubagent: {
      ...storage.settings.asyncSubagent,
      ...(asyncSubagentPatch ?? {}),
    },
    compaction: {
      ...storage.settings.compaction,
      ...(patch.compaction ?? {}),
    },
    logging: { ...storage.settings.logging, ...(patch.logging ?? {}) },
    retry: { ...storage.settings.retry, ...(patch.retry ?? {}) },
    runtime: { ...storage.settings.runtime, ...(runtimePatch ?? {}) },
    providers: {
      ...storage.settings.providers,
      ...(patch.providers ?? {}),
    },
    tools: { ...storage.settings.tools, ...(toolsPatch ?? {}) },
    skills: { ...storage.settings.skills, ...(skillsPatch ?? {}) },
  });
  storage.configuration = await writeHomeConfiguration(
    storage.paths,
    configurationWithSettings(storage.configuration, next),
  );
  storage.settings = settingsFromConfiguration(storage.configuration);
  return storage.settings;
}
