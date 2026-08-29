import { resolve } from "node:path";
import {
  FILE_COMPLETION_RESULT_LIMIT,
  type CompletionItem,
} from "@nervekit/contracts/completions";
import { type ProjectRecord } from "@nervekit/contracts/projects";
import {
  directDirectoryCompletionItems,
  discoverCandidates,
  type FileCompletionCandidate,
  shouldUseDirectoryListing,
} from "./file-completion-candidates.js";
import {
  type CompletionOptions,
  completeFileCandidates,
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
  snapshot?: CandidateSnapshot;
  expiresAt: number;
  refresh?: Promise<CandidateSnapshot>;
};

type FileCompletionServiceOptions = {
  discover?: (root: string) => Promise<FileCompletionCandidate[]>;
  now?: () => number;
};

export class FileCompletionService {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly discover: (
    root: string,
  ) => Promise<FileCompletionCandidate[]>;
  private readonly now: () => number;

  constructor(
    private readonly getProject: (projectId: string) => ProjectRecord,
    options: FileCompletionServiceOptions = {},
  ) {
    this.discover = options.discover ?? discoverCandidates;
    this.now = options.now ?? Date.now;
  }

  async completeFiles(
    projectId: string | undefined,
    query: string,
    options: CompletionOptions = {},
  ): Promise<CompletionItem[]> {
    if (!projectId) return [];
    const project = this.getProject(projectId);
    const root = resolve(project.dir);
    const normalizedQuery = normalizeCompletionQuery(query);
    const limit = Math.min(
      options.limit ?? FILE_COMPLETION_RESULT_LIMIT,
      FILE_COMPLETION_RESULT_LIMIT,
    );

    if (isUnsafeCompletionQuery(normalizedQuery)) return [];
    if (shouldUseDirectoryListing(normalizedQuery)) {
      this.prewarm(project.id, root);
      return directDirectoryCompletionItems(root, normalizedQuery, limit);
    }

    const snapshot = await this.snapshot(project.id, root);
    return completeFileCandidates(snapshot.candidates, normalizedQuery, {
      limit,
    });
  }

  dispose(projectId?: string): void {
    if (!projectId) {
      this.cache.clear();
      return;
    }
    for (const [key, entry] of this.cache) {
      if (
        entry.snapshot?.projectId === projectId ||
        key.startsWith(`${projectId}:`)
      ) {
        this.cache.delete(key);
      }
    }
  }

  private prewarm(projectId: string, root: string): void {
    void this.snapshot(projectId, root).catch(() => undefined);
  }

  private async snapshot(
    projectId: string,
    root: string,
  ): Promise<CandidateSnapshot> {
    const key = `${projectId}:${root}`;
    const now = this.now();
    const entry = this.cache.get(key) ?? { expiresAt: 0 };
    if (!this.cache.has(key)) this.cache.set(key, entry);

    if (entry.snapshot && entry.expiresAt > now) return entry.snapshot;
    if (entry.snapshot) {
      void this.refresh(key, entry, projectId, root).catch(() => undefined);
      return entry.snapshot;
    }
    return this.refresh(key, entry, projectId, root);
  }

  private refresh(
    key: string,
    entry: CacheEntry,
    projectId: string,
    root: string,
  ): Promise<CandidateSnapshot> {
    if (entry.refresh) return entry.refresh;

    const refresh = this.discover(root).then((candidates) => {
      const snapshot = { projectId, root, candidates };
      if (this.cache.get(key) === entry) {
        entry.snapshot = snapshot;
        entry.expiresAt = this.now() + cacheTtlMs;
      }
      return snapshot;
    });
    entry.refresh = refresh;
    void refresh
      .finally(() => {
        if (entry.refresh === refresh) entry.refresh = undefined;
      })
      .catch(() => undefined);
    return refresh;
  }
}
