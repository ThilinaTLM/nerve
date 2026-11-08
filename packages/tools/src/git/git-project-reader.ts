import { realpathSync } from "node:fs";
import { basename } from "node:path";
import type {
  GitDiscoveryResponse,
  GitProjectFileStatusResponse,
  GitRepoSummary,
} from "@nervekit/contracts/git";
import { worktreeGroupKey } from "./git-overview.js";
import type { GitWorkspaceRef } from "./git-observability.js";
import { GitProjectReadCache } from "./read/project-read-cache.js";
import type {
  GitReadBackend,
  GitReadDiscovery,
  GitReadProjectResult,
  GitReadSnapshot,
} from "./read/types.js";

export interface GitProjectReaderContext {
  getProject(projectId: string): GitWorkspaceRef;
  readBackend: GitReadBackend;
  /** Invalidates every cache layer for the project (used by refresh reads). */
  invalidateProjectReads(projectId: string): void;
  summarizeRepo(
    repoDir: string,
    relativePath: string,
    name: string,
    statusOutput: undefined,
    snapshot: Pick<GitReadSnapshot, "branch" | "files">,
  ): Promise<GitRepoSummary>;
}

/** Project-wide discovery and status reads over a shared, generation-aware cache. */
export class GitProjectReader {
  readonly #reads = new GitProjectReadCache<{
    discovery: GitReadDiscovery;
    snapshots: GitReadProjectResult[];
    signal: AbortSignal;
    freshness: { stale: boolean };
  }>();

  constructor(readonly context: GitProjectReaderContext) {}

  invalidate(projectId: string, options: { uncertain?: boolean } = {}): void {
    this.#reads.invalidate(projectId, options);
  }

  close(): Promise<void> {
    return this.#reads.close();
  }

  #read(projectId: string, refresh = false) {
    const root = realpathSync(this.context.getProject(projectId).dir);
    if (refresh) this.context.invalidateProjectReads(projectId);
    return this.#reads.get(
      projectId,
      root,
      async (signal, freshness) => {
        const backend = this.context.readBackend;
        const discovery = await backend.discoverProject(root, signal);
        signal.throwIfAborted();
        const snapshots = await backend.projectSnapshots(
          discovery.repositories,
          true,
          signal,
        );
        signal.throwIfAborted();
        return { discovery, snapshots, signal, freshness };
      },
      refresh,
    );
  }

  async discoverRepos(
    projectId: string,
    refresh = false,
  ): Promise<GitDiscoveryResponse> {
    const project = this.context.getProject(projectId);
    const { discovery, snapshots, signal, freshness } = await this.#read(
      projectId,
      refresh,
    );
    const repos: GitRepoSummary[] = [];
    const errors: NonNullable<GitDiscoveryResponse["errors"]> = [];
    let next = 0;
    const summarize = async () => {
      while (next < snapshots.length) {
        const { repository, snapshot, error } = snapshots[next++];
        if (!snapshot) {
          errors.push({
            repo: repository.relativePath,
            category: error?.category ?? "internal",
            message: "Repository could not be read.",
            retryable: error?.retryable ?? true,
          });
          continue;
        }
        try {
          repos.push(
            await this.context.summarizeRepo(
              repository.workDir,
              repository.relativePath,
              repository.relativePath === "."
                ? project.name
                : basename(repository.workDir),
              undefined,
              {
                ...snapshot,
                files: snapshot.files.filter(
                  (file) => file.index !== "!" && file.worktree !== "!",
                ),
              },
            ),
          );
        } catch {
          errors.push({
            repo: repository.relativePath,
            category: "read",
            message: "Repository metadata could not be read.",
            retryable: true,
          });
        }
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(4, snapshots.length) }, summarize),
    );
    signal.throwIfAborted();
    repos.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
    errors.sort((a, b) => a.repo.localeCompare(b.repo));
    const outsideWorktrees = (discovery.outsideWorktrees ?? []).map(
      ({ commonDir, count }) => ({
        worktreeGroup: worktreeGroupKey(commonDir),
        count,
      }),
    );
    return {
      projectIsRepo: discovery.projectIsRepo,
      repos,
      ...(outsideWorktrees.length > 0 ? { outsideWorktrees } : {}),
      errors,
      ...(freshness.stale ? { stale: true } : {}),
    };
  }

  async projectFileStatus(
    projectId: string,
    refresh = false,
  ): Promise<GitProjectFileStatusResponse> {
    const { snapshots, signal, freshness } = await this.#read(
      projectId,
      refresh,
    );
    signal.throwIfAborted();
    const files: GitProjectFileStatusResponse["files"] = [];
    const errors: NonNullable<GitProjectFileStatusResponse["errors"]> = [];
    for (const { repository, snapshot, error } of snapshots) {
      const repo = repository.relativePath;
      if (!snapshot) {
        errors.push({
          repo,
          category: error?.category ?? "internal",
          message: "Repository could not be read.",
          retryable: error?.retryable ?? true,
        });
        continue;
      }
      const prefix = repo === "." ? "" : `${repo}/`;
      for (const file of snapshot.files)
        files.push({
          ...file,
          repo,
          path: `${prefix}${file.path.replace(/\/$/, "")}`,
          ...(file.renamedFrom
            ? { renamedFrom: `${prefix}${file.renamedFrom}` }
            : {}),
        });
    }
    files.sort((a, b) => a.path.localeCompare(b.path));
    errors.sort((a, b) => a.repo.localeCompare(b.repo));
    return { files, errors, ...(freshness.stale ? { stale: true } : {}) };
  }
}
