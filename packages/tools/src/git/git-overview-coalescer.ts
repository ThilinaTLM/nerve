import type { GitOverviewResponse } from "@nervekit/contracts/git";
import { hasGitRepositoryLane, inGitLane } from "./git-operation-context.js";

const MAX_INFLIGHT_OVERVIEWS = 128;

interface OverviewRead {
  projectId: string;
  freshness: { stale: boolean };
  controller: AbortController;
  value: Promise<GitOverviewResponse>;
}

export interface GitOverviewCoalescerContext {
  resolveRepoDir(projectId: string, relativePath: string): string;
  readOverview(
    projectId: string,
    relativePath: string,
  ): Promise<GitOverviewResponse>;
}

/** Coalesces concurrent overview reads per repository and marks them stale on invalidation. */
export class GitOverviewCoalescer {
  readonly #reads = new Map<string, OverviewRead>();
  #closed = false;

  constructor(readonly context: GitOverviewCoalescerContext) {}

  overview(
    projectId: string,
    relativePath: string,
  ): Promise<GitOverviewResponse> {
    if (this.#closed) return Promise.reject(new Error("Git reads are closed"));
    // Resolve/authorize on every caller; never join a read from a mutation scope.
    const cwd = this.context.resolveRepoDir(projectId, relativePath);
    if (hasGitRepositoryLane())
      return this.context.readOverview(projectId, relativePath);
    const key = JSON.stringify([projectId, cwd]);
    const cached = this.#reads.get(key);
    if (cached)
      return cached.controller.signal.aborted
        ? cached.value
            .catch(() => {})
            .then(() => this.overview(projectId, relativePath))
        : cached.value;
    if (this.#reads.size >= MAX_INFLIGHT_OVERVIEWS)
      return Promise.reject(new Error("Git operation queue is full"));
    const freshness = { stale: false };
    const controller = new AbortController();
    const value = inGitLane(
      cwd,
      false,
      () => this.context.readOverview(projectId, relativePath),
      { signal: controller.signal },
    ).then((result) => ({
      ...result,
      ...(freshness.stale ? { stale: true } : {}),
    }));
    this.#reads.set(key, { projectId, freshness, controller, value });
    void value
      .finally(() => {
        if (this.#reads.get(key)?.value === value) this.#reads.delete(key);
      })
      .catch(() => {});
    return value;
  }

  invalidate(projectId: string, options: { uncertain?: boolean } = {}): void {
    for (const read of this.#reads.values()) {
      if (read.projectId !== projectId) continue;
      read.freshness.stale = true;
      if (!options.uncertain)
        read.controller.abort(
          new DOMException("Git overview superseded", "AbortError"),
        );
    }
  }

  /** Rejects new reads, aborts in-flight ones, and resolves once they settle. */
  async close(): Promise<void> {
    this.#closed = true;
    for (const read of this.#reads.values())
      read.controller.abort(
        new DOMException("Git reads are closed", "AbortError"),
      );
    await Promise.all(
      [...this.#reads.values()].map((r) => r.value.catch(() => {})),
    );
  }
}
