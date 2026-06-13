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
import { dirname } from "node:path";

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

const appendJsonLineQueues = new Map<string, Promise<void>>();

export async function appendJsonLine(
  path: string,
  value: unknown,
  mode?: number,
): Promise<void> {
  const previous = appendJsonLineQueues.get(path) ?? Promise.resolve();
  const queued = previous
    .catch(() => undefined)
    .then(() => appendJsonLineDirect(path, value, mode));
  appendJsonLineQueues.set(path, queued);
  try {
    await queued;
  } finally {
    if (appendJsonLineQueues.get(path) === queued) {
      appendJsonLineQueues.delete(path);
    }
  }
}

export async function rewriteJsonLines(
  path: string,
  values: unknown[],
  mode?: number,
): Promise<void> {
  const previous = appendJsonLineQueues.get(path) ?? Promise.resolve();
  const queued = previous
    .catch(() => undefined)
    .then(() => rewriteJsonLinesDirect(path, values, mode));
  appendJsonLineQueues.set(path, queued);
  try {
    await queued;
  } finally {
    if (appendJsonLineQueues.get(path) === queued) {
      appendJsonLineQueues.delete(path);
    }
  }
}

async function appendJsonLineDirect(
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

async function rewriteJsonLinesDirect(
  path: string,
  values: unknown[],
  mode?: number,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tempPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  const text = values.map((value) => JSON.stringify(value)).join("\n");
  await writeFile(tempPath, text ? `${text}\n` : "", { mode });
  await rename(tempPath, path);
  if (mode !== undefined) await chmod(path, mode).catch(() => undefined);
}

export async function getMtime(path: string): Promise<number | undefined> {
  return stat(path)
    .then((value) => value.mtimeMs)
    .catch(() => undefined);
}
