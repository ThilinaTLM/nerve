import { chmod, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  type DaemonFile,
  type DaemonStartupProgress,
  defaultSettings,
  type PermissionException,
  type PermissionRule,
  type Settings,
  settingsSchema,
  type UpdateSettingsRequest,
} from "@nervekit/contracts";
import { atomicWriteJson, pathExists, writeTextFileIfMissing } from "./json.js";
import { resolveDataDir, type StoragePaths, storagePaths } from "./paths.js";
import type { MigrationReport } from "../migrations/index.js";
import { CanonicalStore } from "../canonical-store/index.js";
import { CanonicalDatabase } from "../canonical-store/canonical-database.js";
import { coordinateStorageStartup } from "../migrations/import/startup-coordinator.js";
import { inspectWorkbenchHome } from "./state-layout.js";

const dataSubdirs = [
  "auth",
  "keys",
  "projects",
  "payloads",
  "agents",
  "plans",
  "logs",
] as const;

export interface InitializedStorage {
  paths: StoragePaths;
  settings: Settings;
  localToken: string;
  migrationReport: MigrationReport;
  canonicalStore: CanonicalStore;
}

export async function readCurrentSettingsForBootstrap(
  home = resolveDataDir(),
): Promise<Settings> {
  const inspection = await inspectWorkbenchHome(home);
  if (
    inspection.kind === "missing" ||
    inspection.kind === "empty" ||
    inspection.kind === "desktop-bootstrap"
  ) {
    return defaultSettings;
  }
  if (inspection.kind !== "current") {
    throw new Error(
      `Nerve settings are unavailable until storage is prepared: ${"reason" in inspection ? inspection.reason : inspection.kind}`,
    );
  }

  const paths = storagePaths(home);
  const path = paths.sqlitePath;
  let raw: unknown;
  try {
    const canonical = new CanonicalDatabase(path);
    try {
      raw = canonical.readSettings<unknown>()?.data;
    } finally {
      canonical.close();
    }
    if (raw === undefined) throw new Error("Canonical settings are missing.");
  } catch (cause) {
    throw new Error(`Current Nerve settings at ${path} are unreadable.`, {
      cause,
    });
  }
  const parsed = settingsSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .slice(0, 8)
      .map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`)
      .join("; ");
    throw new Error(
      `Current Nerve settings at ${path} are invalid: ${issues}`,
      {
        cause: parsed.error,
      },
    );
  }
  return parsed.data;
}

export async function initializeStorage(
  home = resolveDataDir(),
  options: {
    reportStartupProgress?: (progress: DaemonStartupProgress) => void;
  } = {},
): Promise<InitializedStorage> {
  const paths = storagePaths(home);
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
    migrationReport = (
      await coordinateStorageStartup(paths.home, {
        reportStartupProgress: reportProgress,
      })
    ).migrationReport;
  } finally {
    if (heartbeat) clearInterval(heartbeat);
  }
  await chmod(paths.home, 0o700);
  for (const subdir of dataSubdirs) {
    const mode =
      subdir === "auth" || subdir === "keys" || subdir === "payloads"
        ? 0o700
        : 0o755;
    const dir = join(paths.home, subdir);
    await mkdir(dir, { recursive: true, mode });
    await chmod(dir, mode).catch(() => undefined);
  }

  if (!(await pathExists(paths.sqlitePath))) {
    throw new Error(
      `Storage migrations completed without the required SQLite index at ${paths.sqlitePath}.`,
    );
  }

  const canonicalStore = new CanonicalStore(paths.sqlitePath);
  await canonicalStore.initialize();
  const storedSettings = await canonicalStore.readSettings<unknown>();
  if (!storedSettings) {
    await canonicalStore.close();
    throw new Error("Canonical settings are missing after storage migration.");
  }
  const settings = settingsSchema.parse(storedSettings.data);

  if (!(await pathExists(paths.localTokenPath))) {
    const token = `nt_${Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url")}`;
    await writeTextFileIfMissing(paths.localTokenPath, `${token}\n`, 0o600);
  }
  await chmod(paths.localTokenPath, 0o600).catch(() => undefined);
  const localToken = (await readFile(paths.localTokenPath, "utf8")).trim();
  if (!localToken) {
    throw new Error(
      `The local authentication token at ${paths.localTokenPath} is empty.`,
    );
  }

  return { paths, settings, localToken, migrationReport, canonicalStore };
}

function userRule(
  exception: PermissionException,
  timestamp: string,
): PermissionRule {
  const matcherKind = ["read", "edit", "write", "grep", "find", "ls"].includes(
    exception.tool,
  )
    ? ("path_glob" as const)
    : exception.tool === "bash"
      ? ("command_glob" as const)
      : exception.tool === "web_fetch"
        ? ("url_glob" as const)
        : ("whole_tool" as const);
  return {
    id: `rule_user_${exception.id.replace(/^exception_/, "")}`.slice(0, 128),
    scope: "user",
    effect: exception.effect,
    toolName: exception.tool,
    matcherKind,
    pattern: exception.rule,
    enabled: true,
    createdAt: timestamp,
    updatedAt: timestamp,
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
  const current = await storage.canonicalStore.readSettings<Settings>();
  await storage.canonicalStore.writeSettings(next, current?.revision ?? 0);
  if (patch.permissions?.exceptions) {
    const timestamp = new Date().toISOString();
    await storage.canonicalStore.replacePermissionRules(
      "user",
      undefined,
      patch.permissions.exceptions.map((exception) =>
        userRule(exception, timestamp),
      ),
    );
  }
  storage.settings = next;
  return next;
}

export async function writeDaemonFile(
  path: string,
  daemon: DaemonFile,
): Promise<void> {
  await atomicWriteJson(path, daemon, 0o600);
}
