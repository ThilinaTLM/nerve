import { execFile } from "node:child_process";
import type { Dirent } from "node:fs";
import { readdir } from "node:fs/promises";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
} from "node:path";
import { promisify } from "node:util";
import type { CompletionItem } from "@nervekit/contracts";
import {
  labelNameOffset,
  toCompletionItem,
} from "./file-completion-ranking.js";

const execFileAsync = promisify(execFile);

const gitTimeoutMs = 5_000;
const gitMaxBuffer = 16 * 1024 * 1024;
const maxWalkEntries = 20_000;
const maxWalkDepth = 10;

const skippedDirectoryNames = new Set([
  ".git",
  ".cache",
  ".next",
  ".nuxt",
  ".parcel-cache",
  ".pnpm-store",
  ".svelte-kit",
  ".turbo",
  ".yarn",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "out",
  "target",
  "vendor",
]);

export type FileCandidateKind = "file" | "directory";

export type FileCompletionCandidate = {
  relativePath: string;
  name: string;
  parentPath: string;
  depth: number;
  kind: FileCandidateKind;
};

export async function discoverCandidates(
  root: string,
): Promise<FileCompletionCandidate[]> {
  const gitPaths = await gitFilePaths(root);
  if (gitPaths && gitPaths.length > 0) return candidatesFromFilePaths(gitPaths);
  return walkCandidates(root);
}

export function shouldUseDirectoryListing(query: string): boolean {
  if (!query) return true;
  if (query.endsWith("/")) return true;
  return !query.includes("/") && !/\s/.test(query) && query.length < 2;
}

export async function directDirectoryCompletionItems(
  root: string,
  query: string,
  limit: number,
): Promise<CompletionItem[]> {
  const normalizedQuery = query.replace(/\/+$/, "");
  const directoryPart = query.endsWith("/") ? normalizedQuery : parentOf(query);
  const basePart = query.endsWith("/") || directoryPart ? "" : query;
  const relativeDirectory = directoryPart === "." ? "" : directoryPart;
  const targetDirectory = resolve(root, relativeDirectory);
  if (!isInside(root, targetDirectory)) return [];

  let entries: Dirent[];
  try {
    entries = await readdir(targetDirectory, { withFileTypes: true });
  } catch {
    return [];
  }

  return entries
    .filter((entry) => !entry.name.startsWith("."))
    .filter((entry) => !entry.isSymbolicLink())
    .filter(
      (entry) =>
        entry.isFile() ||
        (entry.isDirectory() && !skippedDirectoryNames.has(entry.name)),
    )
    .filter((entry) =>
      entry.name.toLowerCase().startsWith(basePart.toLowerCase()),
    )
    .sort(
      (a, b) =>
        Number(b.isDirectory()) - Number(a.isDirectory()) ||
        a.name.localeCompare(b.name),
    )
    .slice(0, limit)
    .map((entry, index) => {
      const relativePath = normalizeRelativePath(
        join(relativeDirectory, entry.name),
      );
      if (!relativePath) return undefined;
      const candidate = candidateFromPath(
        relativePath,
        entry.isDirectory() ? "directory" : "file",
      );
      const offset = labelNameOffset(candidate);
      return toCompletionItem({
        candidate,
        score: 18_000 - index * 10 + (candidate.kind === "directory" ? 500 : 0),
        matchRanges: basePart ? [[offset, offset + basePart.length]] : [],
      });
    })
    .filter((item): item is CompletionItem => Boolean(item));
}

async function gitFilePaths(root: string): Promise<string[] | undefined> {
  try {
    const { stdout } = await execFileAsync(
      "git",
      [
        "ls-files",
        "--cached",
        "--others",
        "--exclude-standard",
        "-z",
        "--",
        ".",
      ],
      {
        cwd: root,
        timeout: gitTimeoutMs,
        maxBuffer: gitMaxBuffer,
      },
    );
    return stdout
      .toString()
      .split("\0")
      .map(normalizeRelativePath)
      .filter((path): path is string => Boolean(path));
  } catch {
    return undefined;
  }
}

function candidatesFromFilePaths(paths: string[]): FileCompletionCandidate[] {
  const candidates = new Map<string, FileCompletionCandidate>();

  for (const path of paths) {
    const relativePath = normalizeRelativePath(path);
    if (!relativePath) continue;
    const segments = relativePath.split("/").filter(Boolean);
    if (segments.length === 0) continue;

    for (let index = 1; index < segments.length; index += 1) {
      addCandidate(candidates, segments.slice(0, index).join("/"), "directory");
    }
    addCandidate(candidates, relativePath, "file");
  }

  return sortCandidates([...candidates.values()]);
}

async function walkCandidates(
  root: string,
): Promise<FileCompletionCandidate[]> {
  const candidates = new Map<string, FileCompletionCandidate>();
  const state = { count: 0 };

  async function visit(
    relativeDirectory: string,
    depth: number,
  ): Promise<void> {
    if (depth > maxWalkDepth || state.count >= maxWalkEntries) return;

    const absoluteDirectory = resolve(root, relativeDirectory);
    if (!isInside(root, absoluteDirectory)) return;

    let entries: Dirent[];
    try {
      entries = await readdir(absoluteDirectory, { withFileTypes: true });
    } catch {
      return;
    }

    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (state.count >= maxWalkEntries) return;
      if (entry.isSymbolicLink()) continue;

      const relativePath = normalizeRelativePath(
        join(relativeDirectory, entry.name),
      );
      if (!relativePath) continue;

      if (entry.isDirectory()) {
        if (skippedDirectoryNames.has(entry.name)) continue;
        addCandidate(candidates, relativePath, "directory");
        state.count += 1;
        await visit(relativePath, depth + 1);
        continue;
      }

      if (!entry.isFile()) continue;
      addCandidate(candidates, relativePath, "file");
      state.count += 1;
    }
  }

  await visit("", 0);
  return sortCandidates([...candidates.values()]);
}

function addCandidate(
  candidates: Map<string, FileCompletionCandidate>,
  relativePath: string,
  kind: FileCandidateKind,
): void {
  const normalized = normalizeRelativePath(relativePath);
  if (!normalized) return;
  const key = `${kind}:${normalized}`;
  if (candidates.has(key)) return;
  candidates.set(key, candidateFromPath(normalized, kind));
}

function candidateFromPath(
  relativePath: string,
  kind: FileCandidateKind,
): FileCompletionCandidate {
  return {
    relativePath,
    name: basename(relativePath),
    parentPath: parentOf(relativePath),
    depth: relativePath.split("/").length,
    kind,
  };
}

function normalizeRelativePath(path: string): string | undefined {
  const normalized = path.replaceAll("\\", "/").replace(/^\.\/+/, "");
  if (!normalized || normalized.includes("\0")) return undefined;
  if (
    normalized.startsWith("/") ||
    normalized.startsWith("//") ||
    /^[A-Za-z]:\//.test(normalized) ||
    isAbsolute(normalized)
  ) {
    return undefined;
  }
  if (normalized.split("/").some((segment) => !segment || segment === "..")) {
    return undefined;
  }
  return normalized.replace(/\/+$/, "");
}

function parentOf(path: string): string {
  const parent = dirname(path).replaceAll("\\", "/");
  return parent === "." ? "" : parent;
}

function isInside(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function sortCandidates(
  candidates: FileCompletionCandidate[],
): FileCompletionCandidate[] {
  return candidates.sort(
    (a, b) =>
      a.relativePath.localeCompare(b.relativePath) ||
      a.kind.localeCompare(b.kind),
  );
}
