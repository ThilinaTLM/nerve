import { realpath } from "node:fs/promises";
import { resolve } from "node:path";
import {
  filesystemProjectContentSearchRequestSchema,
  filesystemProjectPathSearchRequestSchema,
  type FilesystemProjectContentSearchResponse,
  type FilesystemProjectPathMatch,
  type FilesystemProjectPathSearchResponse,
} from "@nervekit/contracts/filesystem";
import { ApplicationError } from "../../core/application-error.js";
import {
  discoverEntries,
  type FileCompletionEntry,
} from "../completions/file-completion-candidates.js";
import { loadNativeFiles, type NativePathIndex } from "./native-files.js";

type ProjectDirectoryResolver = (projectId: string) => string;

const defaultPathLimit = 50;
const indexIdleMs = 10 * 60_000;
const nativeStaleMs = 30_000;
const fallbackStaleMs = 30_000;
const nativeIndexMaxEntries = 500_000;

type ProjectIndex = {
  root: string;
  native?: NativePathIndex;
  builtAt: number;
  lastUsed: number;
  idleTimer?: NodeJS.Timeout;
  fallback?: Promise<FileCompletionEntry[]>;
};

/** Subsequence fuzzy scorer used when the native index is unavailable. */
export function fuzzyScorePath(
  path: string,
  query: string,
): { score: number; positions: number[] } | undefined {
  const haystack = path.toLowerCase();
  const needle = query.toLowerCase().replaceAll("\\", "/");
  if (!needle) return { score: 0, positions: [] };
  const nameStart = path.lastIndexOf("/") + 1;
  const positions: number[] = [];
  let from = 0;
  let score = 0;
  let previous = -2;
  for (const char of needle) {
    const index = haystack.indexOf(char, from);
    if (index < 0) return undefined;
    positions.push(index);
    score += 1;
    if (index === previous + 1) score += 4;
    if (index === 0 || "/-_. ".includes(haystack[index - 1] ?? "")) score += 3;
    if (index >= nameStart) score += 2;
    previous = index;
    from = index + 1;
  }
  if (haystack.slice(nameStart).includes(needle)) score += 20;
  return { score: score - path.length / 100, positions };
}

/**
 * One path index per project, created lazily on first use. Native when
 * available (ignore-aware, incremental), otherwise the bounded Node walk.
 */
export class ProjectPathIndexes {
  readonly #indexes = new Map<string, ProjectIndex>();

  async #get(projectId: string, directory: string): Promise<ProjectIndex> {
    const root = await realpath(resolve(directory));
    let index = this.#indexes.get(projectId);
    if (index && index.root !== root) {
      this.close(projectId);
      index = undefined;
    }
    if (!index) {
      const files = await loadNativeFiles();
      index = {
        root,
        native: files?.createPathIndex(root, {
          maxEntries: nativeIndexMaxEntries,
        }),
        builtAt: Date.now(),
        lastUsed: Date.now(),
      };
      this.#indexes.set(projectId, index);
    }
    index.lastUsed = Date.now();
    clearTimeout(index.idleTimer);
    index.idleTimer = setTimeout(() => this.close(projectId), indexIdleMs);
    index.idleTimer.unref();
    return index;
  }

  async #fallbackEntries(index: ProjectIndex): Promise<FileCompletionEntry[]> {
    if (!index.fallback || Date.now() - index.builtAt > fallbackStaleMs) {
      index.builtAt = Date.now();
      index.fallback = discoverEntries(index.root);
    }
    return index.fallback;
  }

  /** Monitor hook: project-relative paths changed (empty = unknown, rebuild). */
  notifyChanged(projectId: string, changedPaths: string[] = []): void {
    const index = this.#indexes.get(projectId);
    if (!index) return;
    if (!index.native) {
      index.fallback = undefined;
      return;
    }
    index.builtAt = Date.now();
    void (
      changedPaths.length > 0
        ? index.native.applyChanges(changedPaths)
        : index.native.rebuild()
    ).catch(() => undefined);
  }

  close(projectId: string): void {
    const index = this.#indexes.get(projectId);
    if (!index) return;
    clearTimeout(index.idleTimer);
    this.#indexes.delete(projectId);
    try {
      index.native?.close();
    } catch {
      // Closing is best effort.
    }
  }

  closeAll(): void {
    for (const projectId of [...this.#indexes.keys()]) this.close(projectId);
  }

  async search(
    input: unknown,
    getProjectDirectory: ProjectDirectoryResolver,
  ): Promise<FilesystemProjectPathSearchResponse> {
    const request = filesystemProjectPathSearchRequestSchema.parse(input);
    const limit = request.limit ?? defaultPathLimit;
    const index = await this.#get(
      request.projectId,
      getProjectDirectory(request.projectId),
    );
    if (index.native) {
      if (Date.now() - index.builtAt > nativeStaleMs) {
        // Safety net for missed change notifications; serve current results.
        index.builtAt = Date.now();
        void index.native.rebuild().catch(() => undefined);
      }
      return index.native.search(request.query, {
        limit,
        kinds: request.kinds,
      });
    }
    const entries = await this.#fallbackEntries(index);
    const kinds = request.kinds ? new Set(request.kinds) : undefined;
    const matches: FilesystemProjectPathMatch[] = [];
    for (const entry of entries) {
      if (kinds && !kinds.has(entry.kind)) continue;
      const scored = fuzzyScorePath(entry.relativePath, request.query);
      if (scored)
        matches.push({
          path: entry.relativePath,
          kind: entry.kind,
          ...scored,
        });
    }
    matches.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
    return { matches: matches.slice(0, limit), incomplete: false };
  }

  /** Every indexed entry, for composer `@` completions (one shared index). */
  async entries(
    projectId: string,
    directory: string,
  ): Promise<FileCompletionEntry[]> {
    const index = await this.#get(projectId, directory);
    if (index.native) {
      const result = await index.native.search("", {
        limit: nativeIndexMaxEntries,
      });
      if (result.matches.length > 0)
        return result.matches.map((match) => ({
          relativePath: match.path,
          kind: match.kind,
        }));
    }
    return this.#fallbackEntries(index);
  }
}

export const projectPathIndexes = new ProjectPathIndexes();

export async function searchProjectContent(
  input: unknown,
  getProjectDirectory: ProjectDirectoryResolver,
): Promise<FilesystemProjectContentSearchResponse> {
  const request = filesystemProjectContentSearchRequestSchema.parse(input);
  const files = await loadNativeFiles();
  if (!files)
    throw new ApplicationError(
      501,
      "CONTENT_SEARCH_UNSUPPORTED",
      "Content search requires the native addon, which is unavailable.",
    );
  const root = await realpath(resolve(getProjectDirectory(request.projectId)));
  try {
    return await files.searchContent(root, {
      query: request.query,
      regex: request.regex,
      caseSensitive: request.caseSensitive,
      wholeWord: request.wholeWord,
      include: request.include,
      exclude: request.exclude,
      includeIgnored: request.includeIgnored,
      maxResults: request.maxResults ?? 2_000,
      maxPreviewChars: 240,
      timeoutMs: 10_000,
    });
  } catch (error) {
    if (error instanceof ApplicationError) throw error;
    throw new ApplicationError(
      400,
      "CONTENT_SEARCH_FAILED",
      error instanceof Error ? error.message : "Content search failed.",
    );
  }
}
