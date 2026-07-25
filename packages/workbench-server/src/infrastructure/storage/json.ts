import { constants, createReadStream } from "node:fs";
import {
  access,
  chmod,
  mkdir,
  open,
  readdir,
  readFile,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname } from "node:path";
import { createInterface } from "node:readline";
import {
  atomicReplaceFile,
  atomicWriteFile,
  withFileMutation,
} from "./file-mutations.js";

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

/**
 * Read a complete text snapshot after queued in-process file mutations finish.
 */
export function readTextFileConsistent(path: string): Promise<string> {
  return withFileMutation(path, (resolvedPath) =>
    readFile(resolvedPath, "utf8"),
  );
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

const JSONL_TAIL_CHUNK_BYTES = 64 * 1024;

/**
 * Read only the last `limit` valid JSONL entries from `path`. The file is read
 * backwards in bounded chunks, so startup work depends on the requested tail
 * rather than the total journal size. Returns entries in file order.
 */
export async function readJsonLinesTail<T>(
  path: string,
  limit: number,
): Promise<T[]> {
  if (limit <= 0) return [];
  const handle = await open(path, "r").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return undefined;
    throw error;
  });
  if (!handle) return [];

  const reversed: T[] = [];
  let position = (await handle.stat()).size;
  let leadingFragment: Buffer = Buffer.alloc(0);
  try {
    while (position > 0 && reversed.length < limit) {
      const length = Math.min(JSONL_TAIL_CHUNK_BYTES, position);
      position -= length;
      const chunk = Buffer.allocUnsafe(length);
      await handle.read(chunk, 0, length, position);
      const combined = Buffer.concat([chunk, leadingFragment]);
      const lines = splitBufferLines(combined);
      leadingFragment = lines.shift() ?? Buffer.alloc(0);
      for (let index = lines.length - 1; index >= 0; index -= 1) {
        const value = parseJsonTailLine<T>(path, lines[index]);
        if (value !== undefined) reversed.push(value);
        if (reversed.length >= limit) break;
      }
    }
    if (position === 0 && reversed.length < limit) {
      const value = parseJsonTailLine<T>(path, leadingFragment);
      if (value !== undefined) reversed.push(value);
    }
  } finally {
    await handle.close();
  }
  return reversed.reverse();
}

function splitBufferLines(value: Buffer): Buffer[] {
  const lines: Buffer[] = [];
  let start = 0;
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] !== 0x0a) continue;
    lines.push(value.subarray(start, index));
    start = index + 1;
  }
  lines.push(value.subarray(start));
  return lines;
}

function parseJsonTailLine<T>(
  path: string,
  line: Buffer | undefined,
): T | undefined {
  const trimmed = line?.toString("utf8").trim();
  if (!trimmed) return undefined;
  try {
    return JSON.parse(trimmed) as T;
  } catch (error) {
    process.emitWarning(
      `Skipping invalid JSONL line in tail of ${path}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return undefined;
  }
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
  let kept = 0;
  await atomicReplaceFile(
    path,
    async (output) => {
      const input = createReadStream(path, { encoding: "utf8" });
      const rl = createInterface({ input, crlfDelay: Infinity });
      let index = 0;
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
        await output.write(`${JSON.stringify(value)}\n`, undefined, "utf8");
        kept += 1;
      }
    },
    { mode },
  );
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
  await atomicWriteFile(path, `${JSON.stringify(value, null, 2)}\n`, {
    mode,
  });
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

export function appendJsonLine(
  path: string,
  value: unknown,
  mode?: number,
): Promise<void> {
  return withFileMutation(path, (resolvedPath) =>
    appendJsonLineDirect(resolvedPath, value, mode),
  );
}

export function rewriteJsonLines(
  path: string,
  values: unknown[],
  mode?: number,
): Promise<void> {
  const text = values.map((value) => JSON.stringify(value)).join("\n");
  return atomicWriteFile(path, text ? `${text}\n` : "", { mode });
}

async function appendJsonLineDirect(
  path: string,
  value: unknown,
  mode?: number,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const handle = await open(path, "a", mode);
  try {
    await handle.write(`${JSON.stringify(value)}\n`, undefined, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  if (mode !== undefined) await chmod(path, mode).catch(() => undefined);
}

export async function getMtime(path: string): Promise<number | undefined> {
  return stat(path)
    .then((value) => value.mtimeMs)
    .catch(() => undefined);
}
