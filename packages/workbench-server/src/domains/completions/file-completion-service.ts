import { resolve } from "node:path";
import {
  FILE_COMPLETION_RESULT_LIMIT,
  type CompletionItem,
} from "@nervekit/contracts/completions";
import type { Project } from "@nervekit/contracts/core";
import type { FileCompletionIndex } from "@nervekit/native";
import {
  candidateFromPath,
  directDirectoryCompletionItems,
  discoverCandidates,
  type FileCompletionCandidate,
  shouldUseDirectoryListing,
} from "./file-completion-candidates.js";
import {
  type CompletionOptions,
  isUnsafeCompletionQuery,
  normalizeCompletionQuery,
  toCompletionItem,
} from "./file-completion-items.js";

import {
  completionUsageId,
  rankCompletionCandidates,
} from "./completion-ranking-policy.js";
import type { CompletionUsageStore } from "./completion-usage-store.js";

// Separate retrieval budget from the visible result cap. Requires native's
// generalized/widened query API; never silently fall back to a top-eight pool.
const policyCandidateLimit = 64;

const cacheTtlMs = 120_000;
const maxCachedProjects = 8;
// Includes the active query and callers awaiting discovery/build. Reject excess
// demand rather than silently dropping callers or growing an unbounded queue.
const maxPendingQueries = 32;

type CandidateSnapshot = {
  items: Array<Pick<FileCompletionCandidate, "relativePath" | "kind">>;
  index: FileCompletionIndex;
  users: number;
  retired: boolean;
  closing?: Promise<void>;
};

type CacheEntry = {
  projectId: string;
  root: string;
  snapshot?: CandidateSnapshot;
  expiresAt: number;
  refresh?: Promise<CandidateSnapshot>;
  active: number;
  retired: boolean;
  resources: Set<CandidateSnapshot>;
  retirement?: Promise<void>;
  resolveRetirement?: () => void;
  rejectRetirement?: (error: unknown) => void;
  retirementClosing?: Promise<void>;
};

type FileCompletionServiceOptions = {
  discover?: (root: string) => Promise<FileCompletionCandidate[]>;
  createIndex?: (
    candidates: readonly FileCompletionCandidate[],
  ) => Promise<FileCompletionIndex>;
  now?: () => number;
  maxCachedProjects?: number;
  usageStore?: CompletionUsageStore;
};

export class FileCompletionService {
  // One current root per project, insertion order is LRU. Explicit lifecycle
  // hooks plus this cap bound idle resources without a periodic timer. Active
  // leases may temporarily outlive eviction; they are never forcibly closed.
  private readonly cache = new Map<string, CacheEntry>();
  private readonly retiredEntries = new Set<CacheEntry>();
  private readonly refreshAdmission = new CompletionRefreshAdmission();
  private readonly discover: (
    root: string,
  ) => Promise<FileCompletionCandidate[]>;
  private readonly createIndex: NonNullable<
    FileCompletionServiceOptions["createIndex"]
  >;
  private readonly now: () => number;
  private readonly capacity: number;
  private closed = false;
  private readonly usageStore?: CompletionUsageStore;

  constructor(
    private readonly getProject: (projectId: string) => Project,
    options: FileCompletionServiceOptions = {},
  ) {
    this.usageStore = options.usageStore;
    this.discover = options.discover ?? discoverCandidates;
    // Lazy import also keeps injected lifecycle unit tests independent of the
    // native binary. There is no production TS matching fallback.
    this.createIndex =
      options.createIndex ??
      (async (candidates) => {
        const { createFileCompletionIndex } = await import("@nervekit/native");
        return createFileCompletionIndex(candidates);
      });
    this.now = options.now ?? Date.now;
    this.capacity = options.maxCachedProjects ?? maxCachedProjects;
    if (!Number.isInteger(this.capacity) || this.capacity < 1) {
      throw new RangeError(
        "Completion cache capacity must be a positive integer",
      );
    }
  }

  async completeFiles(
    projectId: string | undefined,
    query: string,
    options: CompletionOptions = {},
  ): Promise<CompletionItem[]> {
    if (this.closed) throw new Error("File completion service is closed");
    if (!projectId) return [];
    const project = this.getProject(projectId);
    const root = resolve(project.directory);
    const normalizedQuery = normalizeCompletionQuery(query);
    if (isUnsafeCompletionQuery(normalizedQuery)) return [];
    const limit = completionLimit(options.limit);
    if (limit === 0) return [];
    const entry = this.entry(project.id, root);
    if (shouldUseDirectoryListing(normalizedQuery)) {
      this.prewarm(entry);
      const items = await directDirectoryCompletionItems(
        root,
        normalizedQuery,
        options.context || this.usageStore ? policyCandidateLimit : limit,
      );
      if (!options.context && !this.usageStore) return items;
      return rankCompletionCandidates(
        items,
        options.context,
        await this.usageStore?.scores(project.id),
      ).slice(0, limit);
    }
    if (entry.active >= maxPendingQueries) {
      throw new Error(
        "Too many pending file completion queries (maximum 32 per project snapshot)",
      );
    }
    entry.active += 1;
    let snapshot: CandidateSnapshot | undefined;
    try {
      snapshot = await this.acquire(entry);
      const current = snapshot;
      // Native owns the bounded FIFO; this service only bounds accepted callers
      // (including discovery/build waiters) and holds their snapshot leases.
      const ranked = !!options.context || !!this.usageStore;
      const matches = await current.index.query(normalizedQuery, {
        limit: ranked ? policyCandidateLimit : limit,
      });
      const items = matches.map((match) => {
        const item = current.items[match.candidateIndex];
        if (!item)
          throw new Error(
            "Completion index returned an invalid candidate index",
          );
        return toCompletionItem({
          candidate: candidateFromPath(item.relativePath, item.kind),
          score: match.score,
          matchRanges: match.matchRanges,
        });
      });
      if (!ranked) return items;
      return rankCompletionCandidates(
        items,
        options.context,
        await this.usageStore?.scores(project.id),
      ).slice(0, limit);
    } finally {
      if (snapshot) {
        snapshot.users -= 1;
        this.maybeClose(entry, snapshot);
      }
      entry.active -= 1;
      this.finishRetirement(entry);
    }
  }

  async recordSelection(
    projectId: string,
    kind: string,
    sourceId: string,
  ): Promise<void> {
    // Resolve the project using the same authorized owner as querying. Caller
    // integration must additionally validate the selected document identity.
    const project = this.getProject(projectId);
    await this.usageStore?.record(
      project.id,
      completionUsageId(kind, sourceId),
    );
  }

  async dispose(projectId?: string): Promise<void> {
    // Shutdown closes admission before yielding, while existing leases drain.
    // Project disposal only retires that snapshot and remains reusable.
    if (projectId === undefined) this.closed = true;
    const entries = new Set([...this.cache.values(), ...this.retiredEntries]);
    await Promise.all(
      [...entries]
        .filter(
          (entry) => projectId === undefined || entry.projectId === projectId,
        )
        .map((entry) => this.retire(entry)),
    );
  }

  private entry(projectId: string, root: string): CacheEntry {
    const existing = this.cache.get(projectId);
    if (existing?.root === root) {
      this.cache.delete(projectId);
      this.cache.set(projectId, existing);
      return existing;
    }
    if (existing) void this.retire(existing).catch(() => undefined);
    while (this.cache.size >= this.capacity) {
      const oldest = this.cache.values().next().value;
      if (oldest) void this.retire(oldest).catch(() => undefined);
    }
    const entry: CacheEntry = {
      projectId,
      root,
      expiresAt: 0,
      active: 0,
      retired: false,
      resources: new Set(),
    };
    this.cache.set(projectId, entry);
    return entry;
  }

  private acquire(entry: CacheEntry): Promise<CandidateSnapshot> {
    if (entry.snapshot) {
      const snapshot = entry.snapshot;
      // Reserve before yielding: a refresh cannot close this snapshot while
      // this caller is waiting for the async continuation or query queue.
      snapshot.users += 1;
      if (entry.expiresAt <= this.now()) this.prewarm(entry);
      return Promise.resolve(snapshot);
    }
    return this.refresh(entry).then((snapshot) => {
      snapshot.users += 1;
      return snapshot;
    });
  }

  private prewarm(entry: CacheEntry): void {
    if (!entry.snapshot || entry.expiresAt <= this.now()) {
      void this.refresh(entry).catch(() => undefined);
    }
  }

  private refresh(entry: CacheEntry): Promise<CandidateSnapshot> {
    if (entry.refresh) return entry.refresh;
    const refresh = this.refreshAdmission.run(async () => {
      const candidates = await this.discover(entry.root);
      const index = await this.createIndex(candidates);
      const snapshot: CandidateSnapshot = {
        items: candidates.map(({ relativePath, kind }) => ({
          relativePath,
          kind,
        })),
        index,
        users: 0,
        retired: entry.retired,
      };
      entry.resources.add(snapshot);
      if (!entry.retired && this.cache.get(entry.projectId) === entry) {
        const previous = entry.snapshot;
        entry.snapshot = snapshot;
        entry.expiresAt = this.now() + cacheTtlMs;
        if (previous) {
          previous.retired = true;
          this.maybeClose(entry, previous);
        }
      }
      return snapshot;
    });
    entry.refresh = refresh;
    const finished = () => {
      if (entry.refresh === refresh) entry.refresh = undefined;
      this.finishRetirement(entry);
    };
    void refresh.then(finished, finished);
    return refresh;
  }

  private maybeClose(entry: CacheEntry, snapshot: CandidateSnapshot): void {
    if (snapshot.retired && snapshot.users === 0 && !entry.retired) {
      void this.close(entry, snapshot).catch(() => undefined);
    }
  }

  private close(entry: CacheEntry, snapshot: CandidateSnapshot): Promise<void> {
    if (!snapshot.closing) {
      snapshot.closing = Promise.resolve().then(() => snapshot.index.close());
      void snapshot.closing.then(
        () => entry.resources.delete(snapshot),
        () => undefined,
      );
    }
    return snapshot.closing;
  }

  private retire(entry: CacheEntry): Promise<void> {
    if (entry.retirement) return entry.retirement;
    entry.retired = true;
    if (this.cache.get(entry.projectId) === entry)
      this.cache.delete(entry.projectId);
    this.retiredEntries.add(entry);
    entry.retirement = new Promise<void>(
      (resolveRetirement, rejectRetirement) => {
        entry.resolveRetirement = resolveRetirement;
        entry.rejectRetirement = rejectRetirement;
      },
    );
    for (const snapshot of entry.resources) snapshot.retired = true;
    this.finishRetirement(entry);
    return entry.retirement;
  }

  private finishRetirement(entry: CacheEntry): void {
    // active includes callers still awaiting discovery/build, so a late build
    // remains usable by those callers even though it is never installed.
    if (
      !entry.retired ||
      entry.active > 0 ||
      entry.refresh ||
      entry.retirementClosing
    )
      return;
    entry.retirementClosing = Promise.all(
      [...entry.resources].map((snapshot) => this.close(entry, snapshot)),
    ).then(() => undefined);
    void entry.retirementClosing.then(
      () => {
        this.retiredEntries.delete(entry);
        entry.resolveRetirement?.();
      },
      (error: unknown) => entry.rejectRetirement?.(error),
    );
  }
}

function completionLimit(requested: number | undefined): number {
  const limit = Math.min(
    requested ?? FILE_COMPLETION_RESULT_LIMIT,
    FILE_COMPLETION_RESULT_LIMIT,
  );
  // Retain useful Array.slice conversions for internal callers. Finite negative
  // limits require unbounded results and are outside the validated API contract.
  if (Number.isNaN(limit) || limit === Number.NEGATIVE_INFINITY) return 0;
  const size = Math.trunc(limit);
  if (size < 0) throw new RangeError("Completion limit must be nonnegative");
  return size;
}

// Admission covers discovery AND native build, including work whose entry was
// evicted while callers still await it. Per-entry coalescing remains in refresh.
class CompletionRefreshAdmission {
  private active = 0;
  private readonly waiting: Array<() => void> = [];

  run<T>(work: () => Promise<T>): Promise<T> {
    if (this.active >= 2) {
      if (this.waiting.length >= 16) {
        return Promise.reject(
          new Error(
            "Too many pending completion refreshes (maximum 2 active and 16 waiting)",
          ),
        );
      }
      return new Promise<T>((resolve, reject) => {
        this.waiting.push(() => {
          void this.run(work).then(resolve, reject);
        });
      });
    }
    this.active += 1;
    return work().finally(() => {
      this.active -= 1;
      this.waiting.shift()?.();
    });
  }
}
