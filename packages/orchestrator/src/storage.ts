import { constants } from "node:fs";
import {
  access,
  appendFile,
  chmod,
  mkdir,
  readdir,
  readFile,
  rename,
  stat,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import {
  type DaemonFile,
  defaultSettings,
  type Settings,
  settingsSchema,
} from "@nerve/shared";

const dataSubdirs = [
  "auth",
  "keys",
  "projects",
  "sessions",
  "agents",
  "plans",
  "handovers",
  "proc",
  "workers",
  "approvals",
  "logs",
] as const;

export interface StoragePaths {
  home: string;
  configPath: string;
  daemonPath: string;
  sqlitePath: string;
  localTokenPath: string;
}

export interface InitializedStorage {
  paths: StoragePaths;
  settings: Settings;
  localToken: string;
}

export function resolveDataDir(explicitHome = process.env.NERVE_HOME): string {
  return explicitHome && explicitHome.trim().length > 0
    ? explicitHome
    : join(homedir(), ".nerve");
}

export function storagePaths(home = resolveDataDir()): StoragePaths {
  return {
    home,
    configPath: join(home, "config.json"),
    daemonPath: join(home, "daemon.json"),
    sqlitePath: join(home, "state.sqlite"),
    localTokenPath: join(home, "auth", "local-token"),
  };
}

export async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export async function readJsonFile<T>(path: string): Promise<T> {
  const raw = await readFile(path, "utf8");
  return JSON.parse(raw) as T;
}

export async function readJsonLines<T>(path: string): Promise<T[]> {
  if (!(await pathExists(path))) return [];
  const raw = await readFile(path, "utf8");
  const values: T[] = [];
  for (const [index, line] of raw.split(/\r?\n/).entries()) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      values.push(JSON.parse(trimmed) as T);
    } catch (error) {
      process.emitWarning(
        `Skipping invalid JSONL line ${path}:${index + 1}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
  return values;
}

export async function listChildDirs(path: string): Promise<string[]> {
  if (!(await pathExists(path))) return [];
  const entries = await readdir(path, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

export async function atomicWriteJson(
  path: string,
  value: unknown,
  mode?: number,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tempPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, { mode });
  await rename(tempPath, path);
  if (mode !== undefined) await chmod(path, mode);
}

export async function writeTextFileIfMissing(
  path: string,
  contents: string,
  mode?: number,
): Promise<void> {
  if (await pathExists(path)) return;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, contents, { mode, flag: "wx" });
  if (mode !== undefined) await chmod(path, mode);
}

export async function appendJsonLine(
  path: string,
  value: unknown,
  mode?: number,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, `${JSON.stringify(value)}\n`, {
    mode,
    encoding: "utf8",
  });
  if (mode !== undefined) await chmod(path, mode).catch(() => undefined);
}

export async function initializeStorage(
  home = resolveDataDir(),
): Promise<InitializedStorage> {
  const paths = storagePaths(home);
  await mkdir(paths.home, { recursive: true, mode: 0o700 });
  await chmod(paths.home, 0o700).catch(() => undefined);
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

export async function getMtime(path: string): Promise<number | undefined> {
  return stat(path)
    .then((value) => value.mtimeMs)
    .catch(() => undefined);
}
