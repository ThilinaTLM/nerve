import { resolve } from "node:path";
import type { CompletionItem, ProjectRecord } from "@nervekit/shared";
import {
  directDirectoryCompletionItems,
  discoverCandidates,
  type FileCompletionCandidate,
  shouldUseDirectoryListing,
} from "./file-completion-candidates.js";
import {
  type CompletionOptions,
  completeFileCandidates,
  defaultCompletionLimit,
  isUnsafeCompletionQuery,
  normalizeCompletionQuery,
} from "./file-completion-ranking.js";

const cacheTtlMs = 120_000;

type CandidateSnapshot = {
  projectId: string;
  root: string;
  candidates: FileCompletionCandidate[];
};

type CacheEntry = {
  expiresAt: number;
  promise: Promise<CandidateSnapshot>;
};

export class FileCompletionService {
  private readonly cache = new Map<string, CacheEntry>();

  constructor(
    private readonly getProject: (projectId: string) => ProjectRecord,
  ) {}

  async completeFiles(
    projectId: string | undefined,
    query: string,
    options: CompletionOptions = {},
  ): Promise<CompletionItem[]> {
    if (!projectId) return [];
    const project = this.getProject(projectId);
    const root = resolve(project.dir);
    const normalizedQuery = normalizeCompletionQuery(query);
    const limit = options.limit ?? defaultCompletionLimit;

    if (isUnsafeCompletionQuery(normalizedQuery)) return [];
    if (shouldUseDirectoryListing(normalizedQuery)) {
      return directDirectoryCompletionItems(root, normalizedQuery, limit);
    }

    const snapshot = await this.snapshot(project.id, root);
    return completeFileCandidates(snapshot.candidates, normalizedQuery, {
      limit,
    });
  }

  invalidate(projectId?: string): void {
    if (!projectId) {
      this.cache.clear();
      return;
    }
    for (const key of this.cache.keys()) {
      if (key.startsWith(`${projectId}:`)) this.cache.delete(key);
    }
  }

  private async snapshot(
    projectId: string,
    root: string,
  ): Promise<CandidateSnapshot> {
    const key = `${projectId}:${root}`;
    const now = Date.now();
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > now) return cached.promise;

    const promise = discoverCandidates(root).then((candidates) => ({
      projectId,
      root,
      candidates,
    }));
    this.cache.set(key, { expiresAt: now + cacheTtlMs, promise });

    try {
      return await promise;
    } catch (error) {
      if (this.cache.get(key)?.promise === promise) this.cache.delete(key);
      throw error;
    }
  }
}
