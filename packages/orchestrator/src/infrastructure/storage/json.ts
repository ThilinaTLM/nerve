import { randomUUID } from "node:crypto";
import { constants, createReadStream, createWriteStream } from "node:fs";
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
import { createInterface } from "node:readline";

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

/**
 * Read only the last `limit` valid JSONL entries from `path`, streaming the
 * file line by line so the whole (potentially huge) file is never held in
 * memory. Returns entries in file order. Invalid lines are skipped.
 */
export async function readJsonLinesTail<T>(
  path: string,
  limit: number,
): Promise<T[]> {
  if (limit <= 0) return [];
  if (!(await pathExists(path))) return [];
  const ring: T[] = [];
  const stream = createReadStream(path, { encoding: "utf8" });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  let index = 0;
  for await (const line of rl) {
    index += 1;
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const value = JSON.parse(trimmed) as T;
      ring.push(value);
      if (ring.length > limit) ring.shift();
    } catch (error) {
      process.emitWarning(
        `Skipping invalid JSONL line ${path}:${index}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
  return ring;
}

/**
 * Stream `path` one JSONL entry at a time, invoking `onValue` for each valid
 * parsed line. Memory stays O(1) regardless of file size. Invalid lines are
 * skipped with a warning.
 */
export async function forEachJsonLine<T>(
  path: string,
  onValue: (value: T) => void,
): Promise<void> {
  if (!(await pathExists(path))) return;
  const stream = createReadStream(path, { encoding: "utf8" });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  let index = 0;
  for await (const line of rl) {
    index += 1;
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      onValue(JSON.parse(trimmed) as T);
    } catch (error) {
      process.emitWarning(
        `Skipping invalid JSONL line ${path}:${index}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}

/**
 * Stream `path`, keeping only the lines for which `predicate` returns true, and
 * atomically replace the file with the filtered result. Parsing/predicate runs
 * one line at a time so the full file is never materialized in memory. Returns
 * the number of retained entries.
 */
export async function filterJsonLinesToFile<T>(
  path: string,
  predicate: (value: T) => boolean,
  mode?: number,
): Promise<number> {
  if (!(await pathExists(path))) return 0;
  await mkdir(dirname(path), { recursive: true });
  const tempPath = `${path}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`;
  const input = createReadStream(path, { encoding: "utf8" });
  const rl = createInterface({ input, crlfDelay: Infinity });
  const output = createWriteStream(tempPath, { mode });
  let kept = 0;
  let index = 0;
  try {
    for await (const line of rl) {
      index += 1;
      const trimmed = line.trim();
      if (!trimmed) continue;
      let value: T;
      try {
        value = JSON.parse(trimmed) as T;
      } catch (error) {
        process.emitWarning(
          `Skipping invalid JSONL line ${path}:${index}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        continue;
      }
      if (!predicate(value)) continue;
      const ok = output.write(`${JSON.stringify(value)}\n`);
      if (!ok) {
        await new Promise<void>((resolve) => output.once("drain", resolve));
      }
      kept += 1;
    }
    await new Promise<void>((resolve, reject) => {
      output.end((error?: Error | null) => (error ? reject(error) : resolve()));
    });
  } catch (error) {
    output.destroy();
    throw error;
  }
  await rename(tempPath, path);
  if (mode !== undefined) await chmod(path, mode).catch(() => undefined);
  return kept;
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
  const tempPath = `${path}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`;
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
  const tempPath = `${path}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`;
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
