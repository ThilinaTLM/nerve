import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { ExecutionWorkerClient } from "@nervekit/native";
import type { Dirent } from "node:fs";
import { readdir } from "node:fs/promises";
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
} from "node:path";
import { promisify } from "node:util";
import type { CompletionItem } from "@nervekit/contracts";
import { fdir } from "fdir";
import {
  labelNameOffset,
  toCompletionItem,
} from "./file-completion-ranking.js";

const execFileAsync = promisify(execFile);

const gitTimeoutMs = 5_000;
const gitMaxBuffer = 16 * 1024 * 1024;
const maxWalkEntries = 20_000;
const maxWalkDepth = 10;

const skippedDirectoryNames = new Set(
  [
    ".angular",
    ".cache",
    ".dart_tool",
    ".expo",
    ".git",
    ".gradle",
    ".hg",
    ".idea",
    ".next",
    ".nuxt",
    ".output",
    ".parcel-cache",
    ".pnpm-store",
    ".svn",
    ".svelte-kit",
    ".turbo",
    ".venv",
    ".vercel",
    ".vite",
    ".webpack",
    ".yarn",
    "__pycache__",
    "bin",
    "bower_components",
    "build",
    "coverage",
    "deriveddata",
    "dist",
    "logs",
    "node_modules",
    "obj",
    "out",
    "pods",
    "target",
    "temp",
    "tmp",
    "vendor",
    "venv",
  ].map((name) => name.toLowerCase()),
);

const skippedFileExtensions = new Set([
  ".7z",
  ".a",
  ".bin",
  ".bz2",
  ".class",
  ".dll",
  ".dylib",
  ".exe",
  ".gz",
  ".jar",
  ".lib",
  ".o",
  ".obj",
  ".pyc",
  ".pyo",
  ".rar",
  ".so",
  ".tar",
  ".tgz",
  ".war",
  ".wasm",
  ".xz",
  ".zip",
]);

export type FileCandidateKind = "file" | "directory";

export type FileCompletionCandidate = {
  relativePath: string;
  pathLower: string;
  name: string;
  nameLower: string;
  stem: string;
  stemLower: string;
  parentPath: string;
  segments: string[];
  segmentsLower: string[];
  depth: number;
  kind: FileCandidateKind;
};

export async function discoverCandidates(
  root: string,
): Promise<FileCompletionCandidate[]> {
  const gitPaths = await gitFilePaths(root);
  if (gitPaths !== undefined) return candidatesFromFilePaths(gitPaths);
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
  if (relativeDirectory && isExcludedRelativePath(relativeDirectory, true)) {
    return [];
  }
  const targetDirectory = resolve(root, relativeDirectory);
  if (!isInside(root, targetDirectory)) return [];

  let entries: Dirent[];
  try {
    entries = await readdir(targetDirectory, { withFileTypes: true });
  } catch {
    return [];
  }

  return entries
    .filter((entry) => !entry.isSymbolicLink())
    .filter((entry) => entry.isFile() || entry.isDirectory())
    .filter((entry) => {
      const relativePath = normalizeRelativePath(
        join(relativeDirectory, entry.name),
      );
      return Boolean(
        relativePath &&
        !isExcludedRelativePath(relativePath, entry.isDirectory()),
      );
    })
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
    const args = [
      "ls-files",
      "--cached",
      "--others",
      "--exclude-standard",
      "-z",
      "--",
      ".",
    ];
    let stdout: string | Buffer;
    if (process.env.NERVE_HOME) {
      const client = await ExecutionWorkerClient.connect(
        process.env.NERVE_HOME,
      );
      const executionId = `completion_${randomUUID()}`;
      const chunks: Buffer[] = [];
      try {
        await client.start({
          executionId,
          command: "git",
          args,
          cwd: root,
          timeoutMs: gitTimeoutMs,
          terminationGraceMs: 100,
          belowNormalPriority: true,
        });
        const terminal = await client.subscribe(executionId, {
          onOutput: (stream, chunk) => {
            if (stream === "stdout") chunks.push(chunk);
          },
        }).settled;
        if (terminal.exitCode !== 0) return undefined;
        stdout = Buffer.concat(chunks);
        if (stdout.length > gitMaxBuffer) return undefined;
      } finally {
        void client.remove(executionId).catch(() => undefined);
      }
    } else {
      ({ stdout } = await execFileAsync("git", args, {
        cwd: root,
        timeout: gitTimeoutMs,
        maxBuffer: gitMaxBuffer,
      }));
    }
    return stdout
      .toString()
      .split("\0")
      .map(normalizeRelativePath)
      .filter((path): path is string =>
        Boolean(path && !isExcludedRelativePath(path, false)),
      );
  } catch {
    return undefined;
  }
}

function candidatesFromFilePaths(
  paths: readonly string[],
): FileCompletionCandidate[] {
  const candidates = new Map<string, FileCompletionCandidate>();

  for (const path of paths) {
    const relativePath = normalizeRelativePath(path);
    if (!relativePath || isExcludedRelativePath(relativePath, false)) continue;
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
  const paths = await new fdir({ excludeSymlinks: true })
    .withDirs()
    .withRelativePaths()
    .withPathSeparator("/")
    .withMaxDepth(maxWalkDepth)
    .withMaxFiles(maxWalkEntries)
    .exclude((directoryName) => isSkippedDirectoryName(directoryName))
    .crawl(root)
    .withPromise();

  const candidates = new Map<string, FileCompletionCandidate>();
  for (const rawPath of paths.slice(0, maxWalkEntries)) {
    if (rawPath === ".") continue;
    const isDirectory = rawPath.endsWith("/");
    const relativePath = normalizeRelativePath(rawPath);
    if (!relativePath || isExcludedRelativePath(relativePath, isDirectory)) {
      continue;
    }
    addCandidate(candidates, relativePath, isDirectory ? "directory" : "file");
  }
  return sortCandidates([...candidates.values()]);
}

function addCandidate(
  candidates: Map<string, FileCompletionCandidate>,
  relativePath: string,
  kind: FileCandidateKind,
): void {
  const normalized = normalizeRelativePath(relativePath);
  if (!normalized || isExcludedRelativePath(normalized, kind === "directory")) {
    return;
  }
  const key = `${kind}:${normalized}`;
  if (candidates.has(key)) return;
  candidates.set(key, candidateFromPath(normalized, kind));
}

export function candidateFromPath(
  relativePath: string,
  kind: FileCandidateKind,
): FileCompletionCandidate {
  const name = basename(relativePath);
  const extension = kind === "file" ? extname(name) : "";
  const stem = extension ? name.slice(0, -extension.length) : name;
  const segments = relativePath.split("/");
  return {
    relativePath,
    pathLower: relativePath.toLowerCase(),
    name,
    nameLower: name.toLowerCase(),
    stem,
    stemLower: stem.toLowerCase(),
    parentPath: parentOf(relativePath),
    segments,
    segmentsLower: segments.map((segment) => segment.toLowerCase()),
    depth: segments.length,
    kind,
  };
}

function normalizeRelativePath(path: string): string | undefined {
  const normalized = path
    .replaceAll("\\", "/")
    .replace(/^\.\/+/, "")
    .replace(/\/+$/, "");
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
  return normalized;
}

function isExcludedRelativePath(path: string, isDirectory: boolean): boolean {
  const segments = path.replaceAll("\\", "/").split("/").filter(Boolean);
  if (segments.some(isSkippedDirectoryName)) return true;
  if (isDirectory) return false;
  return skippedFileExtensions.has(
    extname(segments.at(-1) ?? "").toLowerCase(),
  );
}

function isSkippedDirectoryName(name: string): boolean {
  return skippedDirectoryNames.has(name.toLowerCase());
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
