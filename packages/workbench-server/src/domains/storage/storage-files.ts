import { lstat, readdir } from "node:fs/promises";
import { join } from "node:path";

export interface SizeTally {
  bytes: number;
  files: number;
}

export interface DirectoryUsage extends SizeTally {
  /** Direct child directories, in enumeration order (including empty owners). */
  directories: Map<string, SizeTally>;
  /** Direct regular entries; undefined means lstat failed or the entry changed. */
  rootFiles: Map<string, number | undefined>;
}

export const SQLITE_SIDECAR_SUFFIXES = ["", "-wal", "-shm"] as const;

export function sqliteFilePaths(path: string): string[] {
  return SQLITE_SIDECAR_SUFFIXES.map((suffix) => `${path}${suffix}`);
}

export async function pathsSize(paths: Iterable<string>): Promise<SizeTally> {
  let bytes = 0;
  let files = 0;
  for (const path of paths) {
    const size = await fileSize(path);
    if (size === undefined) continue;
    bytes += size;
    files += 1;
  }
  return { bytes, files };
}

/** Logical sizes per pathname; skips observed symlink entries, with no hard-link
 * deduplication. Explicit roots and directory replacement races can resolve links.
 * Exclusions apply only at the supplied root. This is best-effort, not a race-free
 * snapshot; unreadable/disappearing entries are skipped.
 */
export async function scanDirectoryUsage(
  path: string,
  excludedNames: ReadonlySet<string> = new Set(),
): Promise<DirectoryUsage> {
  const directories = new Map<string, SizeTally>();
  const rootFiles = new Map<string, number | undefined>();
  const tally = await walkDirectory(
    path,
    excludedNames,
    directories,
    rootFiles,
  );
  return { ...tally, directories, rootFiles };
}

export async function dirSize(
  path: string,
  excludedNames: ReadonlySet<string> = new Set(),
): Promise<SizeTally> {
  return walkDirectory(path, excludedNames);
}

async function walkDirectory(
  path: string,
  excludedNames?: ReadonlySet<string>,
  directories?: Map<string, SizeTally>,
  rootFiles?: Map<string, number | undefined>,
): Promise<SizeTally> {
  let bytes = 0;
  let files = 0;
  const entries = await readdir(path, { withFileTypes: true }).catch(() => []);
  // Siblings are measured concurrently (libuv's pool bounds the I/O); results
  // are applied in enumeration order so the maps keep a stable order.
  const measured = await Promise.all(
    entries.map(async (entry) => {
      if (excludedNames?.has(entry.name) || entry.isSymbolicLink())
        return undefined;
      const child = join(path, entry.name);
      if (entry.isDirectory())
        return {
          kind: "directory" as const,
          entry,
          nested: await walkDirectory(child),
        };
      if (entry.isFile())
        return { kind: "file" as const, entry, size: await fileSize(child) };
      return undefined;
    }),
  );
  for (const item of measured) {
    if (!item) continue;
    if (item.kind === "directory") {
      directories?.set(item.entry.name, item.nested);
      bytes += item.nested.bytes;
      files += item.nested.files;
      continue;
    }
    rootFiles?.set(item.entry.name, item.size);
    if (item.size === undefined) continue;
    bytes += item.size;
    files += 1;
  }
  return { bytes, files };
}

export async function fileSize(path: string): Promise<number | undefined> {
  return lstat(path)
    .then((value) => (value.isFile() ? value.size : undefined))
    .catch(() => undefined);
}
