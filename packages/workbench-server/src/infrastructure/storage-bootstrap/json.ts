import { constants } from "node:fs";
import {
  access,
  chmod,
  mkdir,
  open,
  readFile,
  writeFile,
} from "node:fs/promises";
import { dirname } from "node:path";

import type { z } from "zod";
import { atomicWriteFile, withFileMutation } from "./file-mutations.js";

export async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      String(error.code) === "ENOENT"
    ) {
      return false;
    }
    throw error;
  }
}

export async function readJsonFile<S extends z.ZodType>(
  path: string,
  schema: S,
): Promise<z.infer<S>> {
  return schema.parse(await readJsonFileUnknown(path));
}

/** Explicit opt-out: parsed JSON with no shape validation. */
export async function readJsonFileUnknown(path: string): Promise<unknown> {
  const raw = await readFile(path, "utf8");
  return JSON.parse(raw);
}

function parseJsonLine<S extends z.ZodType>(
  line: string,
  schema: S,
): { value: z.infer<S>; raw: unknown } {
  const raw: unknown = JSON.parse(line);
  return { value: schema.parse(raw), raw };
}

/**
 * Read a complete text snapshot after queued in-process file mutations finish.
 */
export function readTextFileConsistent(path: string): Promise<string> {
  return withFileMutation(path, (resolvedPath) =>
    readFile(resolvedPath, "utf8"),
  );
}

export async function readJsonLines<S extends z.ZodType>(
  path: string,
  schema: S,
): Promise<z.infer<S>[]> {
  if (!(await pathExists(path))) return [];
  const raw = await readFile(path, "utf8");
  const values: z.infer<S>[] = [];
  for (const [index, line] of raw.split(/\r?\n/).entries()) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      values.push(parseJsonLine(trimmed, schema).value);
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
export async function readJsonLinesTail<S extends z.ZodType>(
  path: string,
  schema: S,
  limit: number,
): Promise<z.infer<S>[]> {
  if (limit <= 0) return [];
  const reversed: z.infer<S>[] = [];
  await forEachJsonLineReverse(path, schema, (value) => {
    reversed.push(value);
    return reversed.length < limit;
  });
  return reversed.reverse();
}

/**
 * Visit valid JSONL entries newest-first using bounded backwards reads. Return
 * false from the visitor to stop without reading the rest of the file.
 */
export async function forEachJsonLineReverse<S extends z.ZodType>(
  path: string,
  schema: S,
  onValue: (value: z.infer<S>) => boolean | void,
): Promise<void> {
  const handle = await open(path, "r").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return undefined;
    throw error;
  });
  if (!handle) return;

  let position = (await handle.stat()).size;
  let leadingFragment: Buffer = Buffer.alloc(0);
  try {
    while (position > 0) {
      const length = Math.min(JSONL_TAIL_CHUNK_BYTES, position);
      position -= length;
      const chunk = Buffer.allocUnsafe(length);
      await handle.read(chunk, 0, length, position);
      const combined = Buffer.concat([chunk, leadingFragment]);
      const lines = splitBufferLines(combined);
      leadingFragment = lines.shift() ?? Buffer.alloc(0);
      for (let index = lines.length - 1; index >= 0; index -= 1) {
        const value = parseJsonTailLine(path, schema, lines[index]);
        if (value !== undefined && onValue(value) === false) return;
      }
    }
    const value = parseJsonTailLine(path, schema, leadingFragment);
    if (value !== undefined) onValue(value);
  } finally {
    await handle.close();
  }
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

function parseJsonTailLine<S extends z.ZodType>(
  path: string,
  schema: S,
  line: Buffer | undefined,
): z.infer<S> | undefined {
  const trimmed = line?.toString("utf8").trim();
  if (!trimmed) return undefined;
  try {
    return parseJsonLine(trimmed, schema).value;
  } catch (error) {
    process.emitWarning(
      `Skipping invalid JSONL line in tail of ${path}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return undefined;
  }
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
  return appendJsonLines(path, [value], mode);
}

export function appendJsonLines(
  path: string,
  values: readonly unknown[],
  mode?: number,
): Promise<void> {
  if (values.length === 0) return Promise.resolve();
  return withFileMutation(path, (resolvedPath) =>
    appendJsonLinesDirect(resolvedPath, values, mode),
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

async function appendJsonLinesDirect(
  path: string,
  values: readonly unknown[],
  mode?: number,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const contents = values.map((value) => `${JSON.stringify(value)}\n`).join("");
  const handle = await open(path, "a", mode);
  try {
    await handle.write(contents, undefined, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  if (mode !== undefined) await chmod(path, mode).catch(() => undefined);
}
