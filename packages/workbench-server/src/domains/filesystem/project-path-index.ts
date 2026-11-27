import { realpath } from "node:fs/promises";
import { resolve } from "node:path";
import {
  filesystemProjectContentSearchRequestSchema,
  filesystemProjectPathSearchRequestSchema,
  type FilesystemProjectContentSearchResponse,
  type FilesystemProjectPathSearchResponse,
} from "@nervekit/contracts/filesystem";
import { ApplicationError } from "../../core/application-error.js";
import { nativeFiles, type NativePathIndex } from "./native-files.js";

export type FileCompletionEntry = {
  relativePath: string;
  kind: "file" | "directory";
};

type ProjectDirectoryResolver = (projectId: string) => string;

const defaultPathLimit = 50;
const indexIdleMs = 10 * 60_000;
const nativeStaleMs = 30_000;
const nativeIndexMaxEntries = 500_000;

type ProjectIndex = {
  root: string;
  native: NativePathIndex;
  builtAt: number;
  lastUsed: number;
  idleTimer?: NodeJS.Timeout;
};

/**
 * One path index per project, created lazily on first use. Backed by the native
 * addon (ignore-aware, incremental).
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
      index = {
        root,
        native: nativeFiles().createPathIndex(root, {
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

  /** Monitor hook: project-relative paths changed (empty = unknown, rebuild). */
  notifyChanged(projectId: string, changedPaths: string[] = []): void {
    const index = this.#indexes.get(projectId);
    if (!index) return;
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

  /** Every indexed entry, for composer `@` completions (one shared index). */
  async entries(
    projectId: string,
    directory: string,
  ): Promise<FileCompletionEntry[]> {
    const index = await this.#get(projectId, directory);
    const result = await index.native.search("", {
      limit: nativeIndexMaxEntries,
    });
    return result.matches.map((match) => ({
      relativePath: match.path,
      kind: match.kind,
    }));
  }
}

export const projectPathIndexes = new ProjectPathIndexes();

export async function searchProjectContent(
  input: unknown,
  getProjectDirectory: ProjectDirectoryResolver,
): Promise<FilesystemProjectContentSearchResponse> {
  const request = filesystemProjectContentSearchRequestSchema.parse(input);
  const root = await realpath(resolve(getProjectDirectory(request.projectId)));
  try {
    return await nativeFiles().searchContent(root, {
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
    throw mapContentSearchError(error);
  }
}

const INVALID_SEARCH_PATTERN = "INVALID_SEARCH_PATTERN";

/** Maps a native content-search failure to an ApplicationError. The addon
 * reports a bad pattern as `INVALID_SEARCH_PATTERN:<column>:<description>`,
 * which becomes a 422 carrying `details.code` and an optional `details.column`. */
export function mapContentSearchError(error: unknown): ApplicationError {
  const message = error instanceof Error ? error.message : "";
  const match = new RegExp(`^${INVALID_SEARCH_PATTERN}:(\\d*):(.+)$`, "s").exec(
    message,
  );
  if (match) {
    const column = match[1] ? Number(match[1]) : undefined;
    return new ApplicationError(422, INVALID_SEARCH_PATTERN, match[2].trim(), {
      details: {
        code: INVALID_SEARCH_PATTERN,
        ...(column !== undefined ? { column } : {}),
      },
    });
  }
  return new ApplicationError(
    400,
    "CONTENT_SEARCH_FAILED",
    message || "Content search failed.",
  );
}
