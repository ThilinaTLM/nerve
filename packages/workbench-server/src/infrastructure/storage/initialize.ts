import { chmod, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  type DaemonFile,
  type DaemonStartupProgress,
  defaultSettings,
  type Settings,
  settingsSchema,
  type UpdateSettingsRequest,
} from "@nervekit/contracts";
import {
  atomicWriteJson,
  pathExists,
  readJsonFile,
  writeTextFileIfMissing,
} from "./json.js";
import { resolveDataDir, type StoragePaths, storagePaths } from "./paths.js";
import { normalizeSettings } from "./settings-normalization.js";
import {
  runStorageMigrations,
  type MigrationReport,
} from "../migrations/index.js";

const dataSubdirs = [
  "auth",
  "keys",
  "projects",
  "conversations",
  "agents",
  "plans",
  "workers",
  "logs",
] as const;

export interface InitializedStorage {
  paths: StoragePaths;
  settings: Settings;
  localToken: string;
  migrationReport: MigrationReport;
}

export async function readPersistedSettingsForBootstrap(
  home = resolveDataDir(),
): Promise<Settings> {
  const path = storagePaths(home).configPath;
  if (!(await pathExists(path))) return defaultSettings;
  return normalizeSettings(await readJsonFile<unknown>(path)).settings;
}

export async function initializeStorage(
  home = resolveDataDir(),
  options: {
    reportStartupProgress?: (progress: DaemonStartupProgress) => void;
  } = {},
): Promise<InitializedStorage> {
  const paths = storagePaths(home);
  await mkdir(paths.home, { recursive: true, mode: 0o700 });
  await chmod(paths.home, 0o700).catch(() => undefined);
  let currentProgress: DaemonStartupProgress = {
    type: "nerve.startup.progress",
    phase: "storage-check",
    message: "Checking workspace storage",
  };
  const reportProgress = (progress: DaemonStartupProgress) => {
    currentProgress = progress;
    options.reportStartupProgress?.(progress);
  };
  reportProgress(currentProgress);
  const heartbeat = options.reportStartupProgress
    ? setInterval(() => reportProgress(currentProgress), 5_000)
    : undefined;
  heartbeat?.unref();
  let migrationReport: MigrationReport;
  try {
    migrationReport = await runStorageMigrations(paths.home, {
      reportProgress: () => {
        reportProgress({
          type: "nerve.startup.progress",
          phase: "storage-migration",
          message: "Upgrading workspace storage",
        });
      },
    });
  } finally {
    if (heartbeat) clearInterval(heartbeat);
  }
  for (const subdir of dataSubdirs) {
    const mode = subdir === "auth" || subdir === "keys" ? 0o700 : 0o755;
    const dir = join(paths.home, subdir);
    await mkdir(dir, { recursive: true, mode });
    await chmod(dir, mode).catch(() => undefined);
  }

  if (!(await pathExists(paths.configPath))) {
    await atomicWriteJson(paths.configPath, defaultSettings, 0o600);
  }

  const settings = settingsSchema.parse(
    await readJsonFile<unknown>(paths.configPath),
  );

  await writeTextFileIfMissing(paths.sqlitePath, "", 0o600);

  if (!(await pathExists(paths.localTokenPath))) {
    const token = `nt_${Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url")}`;
    await writeTextFileIfMissing(paths.localTokenPath, `${token}\n`, 0o600);
  }
  await chmod(paths.localTokenPath, 0o600).catch(() => undefined);
  const localToken = (await readFile(paths.localTokenPath, "utf8")).trim();

  return { paths, settings, localToken, migrationReport };
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
  const defaultApprovalPolicyPatch = patch.defaultApprovalPolicy
    ? {
        ...storage.settings.defaultApprovalPolicy,
        ...patch.defaultApprovalPolicy,
      }
    : undefined;
  const lastAgentSelectionPatch = patch.lastAgentSelection
    ? {
        ...patch.lastAgentSelection,
        ...(patch.lastAgentSelection.approvalPolicy
          ? {
              approvalPolicy: {
                ...storage.settings.lastAgentSelection.approvalPolicy,
                ...patch.lastAgentSelection.approvalPolicy,
              },
            }
          : {}),
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
      }
    : undefined;
  const skillsPatch = patch.skills
    ? {
        ...patch.skills,
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
    ...(defaultApprovalPolicyPatch
      ? { defaultApprovalPolicy: defaultApprovalPolicyPatch }
      : {}),
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
  await atomicWriteJson(storage.paths.configPath, next, 0o600);
  storage.settings = next;
  return next;
}

export async function writeDaemonFile(
  path: string,
  daemon: DaemonFile,
): Promise<void> {
  await atomicWriteJson(path, daemon, 0o600);
}

export async function removeStaleDaemonFile(path: string): Promise<void> {
  if (!(await pathExists(path))) return;
  const daemon = await readJsonFile<DaemonFile>(path).catch(() => undefined);
  if (!daemon) return;
  try {
    process.kill(daemon.pid, 0);
  } catch {
    await atomicWriteJson(
      path,
      { ...daemon, stale: true, stoppedAt: new Date().toISOString() },
      0o600,
    );
  }
}
