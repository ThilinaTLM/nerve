import { chmod, mkdir, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import {
  type DaemonFile,
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

const dataSubdirs = [
  "auth",
  "keys",
  "projects",
  "conversations",
  "agents",
  "plans",
  "handovers",
  "workers",
  "approvals",
  "user-questions",
  "logs",
  "prompt-suggestions",
] as const;

export interface InitializedStorage {
  paths: StoragePaths;
  settings: Settings;
  localToken: string;
}

export async function initializeStorage(
  home = resolveDataDir(),
): Promise<InitializedStorage> {
  const paths = storagePaths(home);
  await mkdir(paths.home, { recursive: true, mode: 0o700 });
  await chmod(paths.home, 0o700).catch(() => undefined);
  await ensureStateLayout(paths.home);
  for (const subdir of dataSubdirs) {
    const mode = subdir === "auth" || subdir === "keys" ? 0o700 : 0o755;
    const dir = join(paths.home, subdir);
    await mkdir(dir, { recursive: true, mode });
    await chmod(dir, mode).catch(() => undefined);
  }

  if (!(await pathExists(paths.configPath))) {
    await atomicWriteJson(paths.configPath, defaultSettings, 0o600);
  }

  const rawSettings = await readJsonFile<unknown>(paths.configPath);
  const settings = settingsSchema.parse({
    ...defaultSettings,
    ...(rawSettings as object),
  });

  await writeTextFileIfMissing(paths.sqlitePath, "", 0o600);

  if (!(await pathExists(paths.localTokenPath))) {
    const token = `nt_${Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url")}`;
    await writeTextFileIfMissing(paths.localTokenPath, `${token}\n`, 0o600);
  }
  await chmod(paths.localTokenPath, 0o600).catch(() => undefined);
  const localToken = (await readFile(paths.localTokenPath, "utf8")).trim();

  return { paths, settings, localToken };
}

async function ensureStateLayout(home: string): Promise<void> {
  const markerPath = join(home, "VERSION");
  if (await pathExists(markerPath)) {
    try {
      const marker = JSON.parse(await readFile(markerPath, "utf8")) as {
        format?: unknown;
        version?: unknown;
      };
      if (marker.format === "nerve-workbench-state" && marker.version === 2) {
        const retiredProcesses = join(home, "proc");
        if (
          (await pathExists(retiredProcesses)) &&
          (await readdir(retiredProcesses)).length > 0
        )
          throw new Error("retired process state");
        return;
      }
    } catch {
      // Report one deterministic reset instruction below.
    }
    throw new Error(
      `Incompatible Nerve state at ${home}. Reset this directory before starting Nerve Protocol v1.`,
    );
  }
  const entries = await readdir(home, { withFileTypes: true });
  const desktopBootstrapDirectories = new Set(["crashes", "logs"]);
  const containsOnlyDesktopBootstrapDiagnostics = entries.every(
    (entry) =>
      entry.isDirectory() && desktopBootstrapDirectories.has(entry.name),
  );
  if (entries.length > 0 && !containsOnlyDesktopBootstrapDiagnostics) {
    throw new Error(
      `Incompatible Nerve state at ${home}. Reset this directory before starting Nerve Protocol v1.`,
    );
  }
  await writeTextFileIfMissing(
    markerPath,
    `${JSON.stringify({ format: "nerve-workbench-state", version: 2 }, null, 2)}\n`,
    0o600,
  );
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
  const jiraPatch = patch.tools?.jira
    ? {
        ...patch.tools.jira,
        ...(patch.tools.jira.siteUrl === null ? { siteUrl: undefined } : {}),
        ...(patch.tools.jira.email === null ? { email: undefined } : {}),
        ...(patch.tools.jira.defaultProjectKey === null
          ? { defaultProjectKey: undefined }
          : {}),
      }
    : undefined;
  const confluencePatch = patch.tools?.confluence
    ? {
        ...patch.tools.confluence,
        ...(patch.tools.confluence.siteUrl === null
          ? { siteUrl: undefined }
          : {}),
        ...(patch.tools.confluence.email === null ? { email: undefined } : {}),
        ...(patch.tools.confluence.defaultSpaceKey === null
          ? { defaultSpaceKey: undefined }
          : {}),
      }
    : undefined;
  const toolsPatch = patch.tools
    ? {
        ...patch.tools,
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
      }
    : undefined;
  const next = settingsSchema.parse({
    ...storage.settings,
    ...patch,
    ...defaultModelPatch,
    ...(defaultApprovalPolicyPatch
      ? { defaultApprovalPolicy: defaultApprovalPolicyPatch }
      : {}),
    server: { ...storage.settings.server, ...(patch.server ?? {}) },
    ui: { ...storage.settings.ui, ...(patch.ui ?? {}) },
    desktop: { ...storage.settings.desktop, ...(patch.desktop ?? {}) },
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
    tools: { ...storage.settings.tools, ...(toolsPatch ?? {}) },
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
