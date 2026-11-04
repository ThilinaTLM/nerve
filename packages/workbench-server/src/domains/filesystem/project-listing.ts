import type { Dirent, Stats } from "node:fs";
import { readdir, realpath, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { isPathInside } from "@nervekit/tools/execution";
import {
  type FilesystemProjectEntry,
  filesystemProjectEntriesQuerySchema,
} from "@nervekit/contracts/filesystem";
import { loadNativeFiles } from "./native-files.js";

const isInside = isPathInside;

async function mapBatched<T, U>(
  values: T[],
  batchSize: number,
  mapper: (value: T) => Promise<U>,
): Promise<U[]> {
  const results: U[] = [];
  for (let index = 0; index < values.length; index += batchSize) {
    results.push(
      ...(await Promise.all(
        values.slice(index, index + batchSize).map(mapper),
      )),
    );
  }
  return results;
}

const defaultProjectEntryLimit = 500;

type ProjectEntrySortKey = [number, string, string, string];

export function normalizeProjectRelativeDirectory(
  rawPath: string | undefined,
): string {
  const path = rawPath?.trim().replaceAll("\\", "/") ?? "";
  if (!path) return "";
  if (path.includes("\0") || path.startsWith("/") || /^[A-Za-z]:\//.test(path))
    throw new Error("Project directory path must be relative.");
  const segments = path.split("/");
  if (
    segments.some((segment) => !segment || segment === "." || segment === "..")
  )
    throw new Error("Project directory path contains an invalid segment.");
  return segments.join("/");
}

function projectEntrySortKey(
  entry: FilesystemProjectEntry,
): ProjectEntrySortKey {
  return [
    entry.kind === "directory" ? 0 : entry.kind === "file" ? 1 : 2,
    entry.name.toLocaleLowerCase(),
    entry.name,
    entry.path,
  ];
}

function compareProjectEntryKeys(
  left: ProjectEntrySortKey,
  right: ProjectEntrySortKey,
): number {
  return (
    left[0] - right[0] ||
    left[1].localeCompare(right[1], undefined, { numeric: true }) ||
    left[2].localeCompare(right[2], undefined, { numeric: true }) ||
    left[3].localeCompare(right[3])
  );
}

function encodeProjectEntryCursor(
  path: string,
  key: ProjectEntrySortKey,
): string {
  return Buffer.from(JSON.stringify({ path, key })).toString("base64url");
}

function decodeProjectEntryCursor(
  cursor: string,
  path: string,
): ProjectEntrySortKey {
  try {
    const decoded = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8"),
    ) as {
      path?: unknown;
      key?: unknown;
    };
    if (
      decoded.path !== path ||
      !Array.isArray(decoded.key) ||
      decoded.key.length !== 4 ||
      typeof decoded.key[0] !== "number" ||
      decoded.key.slice(1).some((value) => typeof value !== "string")
    )
      throw new Error("invalid");
    return decoded.key as ProjectEntrySortKey;
  } catch {
    throw new Error("Invalid or stale project directory cursor.");
  }
}

async function classifyProjectEntry(
  root: string,
  directory: string,
  relativeDirectory: string,
  entry: Dirent,
): Promise<FilesystemProjectEntry> {
  const path = relativeDirectory
    ? `${relativeDirectory}/${entry.name}`
    : entry.name;
  if (!entry.isSymbolicLink()) {
    return {
      name: entry.name,
      path,
      kind: entry.isDirectory()
        ? "directory"
        : entry.isFile()
          ? "file"
          : "other",
      symlink: false,
    };
  }

  let kind: FilesystemProjectEntry["kind"] = "other";
  try {
    const target = await realpath(join(directory, entry.name));
    if (isInside(root, target)) {
      const info = await stat(target);
      kind = info.isDirectory()
        ? "directory"
        : info.isFile()
          ? "file"
          : "other";
    }
  } catch {
    // Broken and inaccessible links stay visible as non-browsable entries.
  }
  return { name: entry.name, path, kind, symlink: true };
}

type ListingCacheEntry = {
  /** mtimes of the project-level ignore files the `ignored` flags depend on. */
  ignoreStamp: string;
  mtimeMs: number;
  ino: number;
  cachedAt: number;
  entries: FilesystemProjectEntry[];
};

const listingMaxAgeMs = 30_000;
const listingPagingWindowMs = 1_000;
const listingSettleMs = 2_000;

const listingCacheLimit = 128;
const listingCache = new Map<string, ListingCacheEntry>();

export function clearProjectListingCache(): void {
  listingCache.clear();
}

/**
 * Editing an ignore file does not change any directory mtime, so cached
 * `ignored` flags are also keyed by the project-level ignore files. Nested
 * `.gitignore` files are covered by the cache's maximum age.
 */
async function ignoreFilesStamp(root: string): Promise<string> {
  const stamps = await Promise.all(
    [".gitignore", ".ignore", ".git/info/exclude"].map(async (name) => {
      try {
        return String((await stat(join(root, name))).mtimeMs);
      } catch {
        return "-";
      }
    }),
  );
  return stamps.join(":");
}

/**
 * Full sorted listing of one directory, cached per directory and validated by
 * its mtime so paging does not re-read it. Native (ignore-aware) when
 * available, Node `readdir` otherwise.
 */
async function sortedDirectoryEntries(
  root: string,
  resolvedDirectory: string,
  relativeDirectory: string,
  info: Stats,
): Promise<FilesystemProjectEntry[]> {
  // Entry paths are relative to the project root, so the root is part of the key.
  const key = `${root}\0${resolvedDirectory}`;
  const cached = listingCache.get(key);
  const now = Date.now();
  const ignoreStamp = await ignoreFilesStamp(root);
  if (
    cached &&
    cached.ignoreStamp === ignoreStamp &&
    cached.mtimeMs === info.mtimeMs &&
    cached.ino === info.ino &&
    now - cached.cachedAt < listingMaxAgeMs &&
    // A directory modified right before listing may change again within the
    // same mtime tick; only trust settled listings beyond the paging window.
    (cached.cachedAt - cached.mtimeMs > listingSettleMs ||
      now - cached.cachedAt < listingPagingWindowMs)
  ) {
    listingCache.delete(key);
    listingCache.set(key, cached);
    return cached.entries;
  }
  const files = await loadNativeFiles();
  let entries: FilesystemProjectEntry[];
  if (files) {
    entries = (
      await files.listDirectory(root, relativeDirectory, {
        includeHidden: true,
      })
    ).map(({ name, path, kind, symlink, ignored }) => ({
      name,
      path,
      kind,
      symlink,
      ignored,
    }));
  } else {
    entries = await mapBatched(
      await readdir(resolvedDirectory, { withFileTypes: true }),
      32,
      (entry) =>
        classifyProjectEntry(root, resolvedDirectory, relativeDirectory, entry),
    );
    entries.sort((left, right) =>
      compareProjectEntryKeys(
        projectEntrySortKey(left),
        projectEntrySortKey(right),
      ),
    );
  }
  listingCache.set(key, {
    ignoreStamp,
    mtimeMs: info.mtimeMs,
    ino: info.ino,
    cachedAt: now,
    entries,
  });
  if (listingCache.size > listingCacheLimit)
    listingCache.delete(listingCache.keys().next().value as string);
  return entries;
}

export async function projectDirectoryEntries(
  input: unknown,
  getProjectDirectory: (projectId: string) => string,
) {
  const query = filesystemProjectEntriesQuerySchema.parse(input);
  const relativeDirectory = normalizeProjectRelativeDirectory(query.path);
  const root = await realpath(resolve(getProjectDirectory(query.projectId)));
  const directory = resolve(root, relativeDirectory);
  if (!isInside(root, directory))
    throw new Error("Project directory path escapes the project root.");

  const resolvedDirectory = await realpath(directory);
  if (!isInside(root, resolvedDirectory))
    throw new Error("Project directory path escapes the project root.");
  const info = await stat(resolvedDirectory);
  if (!info.isDirectory())
    throw new Error(`${relativeDirectory || "."} is not a directory.`);

  const entries = await sortedDirectoryEntries(
    root,
    resolvedDirectory,
    relativeDirectory,
    info,
  );

  let start = 0;
  if (query.cursor) {
    const cursorKey = decodeProjectEntryCursor(query.cursor, relativeDirectory);
    const cursorIndex = entries.findIndex(
      (entry) =>
        compareProjectEntryKeys(projectEntrySortKey(entry), cursorKey) === 0,
    );
    if (cursorIndex < 0)
      throw new Error("Invalid or stale project directory cursor.");
    start = cursorIndex + 1;
  }

  const limit = query.limit ?? defaultProjectEntryLimit;
  const page = entries.slice(start, start + limit);
  const last = page.at(-1);
  return {
    projectId: query.projectId,
    path: relativeDirectory,
    entries: page,
    nextCursor:
      last && start + page.length < entries.length
        ? encodeProjectEntryCursor(relativeDirectory, projectEntrySortKey(last))
        : undefined,
  };
}
