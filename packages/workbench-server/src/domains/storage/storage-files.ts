import { lstat, readdir } from "node:fs/promises";
import { basename, join } from "node:path";

export interface SizeTally {
  bytes: number;
  files: number;
}

export const SQLITE_SIDECAR_SUFFIXES = ["", "-wal", "-shm"] as const;

export function sqliteFilePaths(path: string): string[] {
  return SQLITE_SIDECAR_SUFFIXES.map((suffix) => `${path}${suffix}`);
}

export function queryCacheFilePaths(path: string): string[] {
  return [
    ...sqliteFilePaths(path),
    ...sqliteFilePaths(`${path}.cleanup-backup`),
  ];
}

export function queryCacheFileNames(path: string): Set<string> {
  return new Set(
    queryCacheFilePaths(path).map((candidate) => basename(candidate)),
  );
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

export async function dirSize(
  path: string,
  excludedNames: ReadonlySet<string> = new Set(),
): Promise<SizeTally> {
  let bytes = 0;
  let files = 0;
  const entries = await readdir(path, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (excludedNames.has(entry.name) || entry.isSymbolicLink()) continue;
    const child = join(path, entry.name);
    if (entry.isDirectory()) {
      const nested = await dirSize(child);
      bytes += nested.bytes;
      files += nested.files;
    } else if (entry.isFile()) {
      const size = await fileSize(child);
      if (size === undefined) continue;
      bytes += size;
      files += 1;
    }
  }
  return { bytes, files };
}

export async function fileSize(path: string): Promise<number | undefined> {
  return lstat(path)
    .then((value) => (value.isFile() ? value.size : undefined))
    .catch(() => undefined);
}
