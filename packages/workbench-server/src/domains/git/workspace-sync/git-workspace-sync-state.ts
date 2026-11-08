import type {
  GitProjectReadError,
  GitRepoDetailSnapshot,
  GitRepoSummary,
  GitWorkspaceSnapshot,
} from "@nervekit/contracts/git";
import type { GitOverviewResponse } from "@nervekit/contracts/git";
import { lstat } from "node:fs/promises";
import { join } from "node:path";
import type { FetchCandidate } from "./git-background-fetch-policy.js";
import { fingerprint, type DirtyState } from "./git-workspace-sync-policy.js";

export type Waiter = { resolve(): void; reject(error: unknown): void };

export type RepoEntry = {
  repo: string;
  summary?: GitRepoSummary;
  summaryFp?: string;
  detail?: GitRepoDetailSnapshot;
  detailFp?: string;
  dirty?: DirtyState;
  mutation: boolean;
  /** The pending dirty mark only exists to warm a hinted repository's detail. */
  warmOnly: boolean;
  forceDetail: boolean;
  live: boolean;
  running: boolean;
  /** Monitor reported the scope unreliable. */
  degraded: boolean;
  /** Monitor poll failed since the last proven change. */
  pollUncertain: boolean;
  lastReadAt: number | null;
  detailRevision?: number;
  superseded: number;
  failed?: GitProjectReadError;
  waiters: Waiter[];
};

export type ProjectEntry = {
  projectId: string;
  revision: number;
  loaded: boolean;
  projectIsRepo: boolean;
  discoveryErrors: GitProjectReadError[];
  repos: Map<string, RepoEntry>;
  visible: boolean;
  selected?: string;
  /** Repository paths the last discovery reported (repositories and read errors). */
  discoveredKeys: Set<string>;
  structureCheck: { running: boolean; nextAt: number };
  discovery: {
    dirty?: DirtyState;
    running: boolean;
    waiters: Waiter[];
  };
};

export function projectErrors(project: ProjectEntry): GitProjectReadError[] {
  const failed = [...project.repos.values()].flatMap((entry) =>
    entry.failed ? [entry.failed] : [],
  );
  const known = new Set(failed.map((error) => error.repo));
  return [
    ...project.discoveryErrors.filter((error) => !known.has(error.repo)),
    ...failed,
  ].sort((a, b) => a.repo.localeCompare(b.repo));
}

export function projectView(
  project: ProjectEntry,
  watched: boolean,
): GitWorkspaceSnapshot {
  const summaries = [...project.repos.values()]
    .flatMap((entry) => (entry.summary ? [entry.summary] : []))
    .sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  const staleRepos = [...project.repos.values()]
    .filter(
      (entry) =>
        entry.summary &&
        (!watched ||
          entry.dirty ||
          entry.running ||
          entry.failed ||
          entry.degraded ||
          entry.pollUncertain),
    )
    .map((entry) => entry.repo)
    .sort();
  return {
    projectId: project.projectId,
    revision: project.revision,
    loaded: project.loaded,
    projectIsRepo: project.projectIsRepo,
    summaries,
    errors: projectErrors(project),
    stale:
      !watched ||
      !!project.discovery.dirty ||
      project.discovery.running ||
      staleRepos.length > 0,
    staleRepos,
  };
}

/** A newer invalidation aborted the read. */
export function isSuperseded(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "AbortError" ||
      ("category" in error && error.category === "cancelled"))
  );
}

export function errorCategory(error: unknown): string {
  return error instanceof Error &&
    "category" in error &&
    typeof error.category === "string"
    ? error.category
    : "internal";
}

/**
 * Resolves when the next read of `target` completes; gives up quietly after
 * `timeoutMs` so callers fall back to the latest known state.
 */
export function waitForRead(
  target: { waiters: Waiter[] },
  timeoutMs: number,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const waiter: Waiter = {
      resolve: () => {
        clearTimeout(timer);
        resolve();
      },
      reject: (error) => {
        clearTimeout(timer);
        reject(error);
      },
    };
    const timer = setTimeout(() => {
      target.waiters = target.waiters.filter((item) => item !== waiter);
      resolve();
    }, timeoutMs);
    timer.unref();
    target.waiters.push(waiter);
  });
}

/** Visible projects' repositories that have a remote (input for the background fetch). */
export function fetchCandidates(
  projects: Iterable<ProjectEntry>,
): FetchCandidate[] {
  const candidates: FetchCandidate[] = [];
  for (const project of projects)
    for (const entry of project.repos.values())
      if (entry.summary?.hasRemote)
        candidates.push({
          projectId: project.projectId,
          repo: entry.repo,
          group: entry.summary.worktreeGroup,
          primary: entry.summary.primaryWorktree,
        });
  return candidates;
}

/** Store an overview's detail on the entry; true when its content changed. */
export function applyDetail(
  project: ProjectEntry,
  entry: RepoEntry,
  overview: GitOverviewResponse,
  signature = "",
): boolean {
  const next = {
    files: overview.files,
    stagedCount: overview.stagedCount,
    unstagedCount: overview.unstagedCount,
    untrackedCount: overview.untrackedCount,
    stashes: overview.stashes,
  };
  // Stash ages ("2 minutes ago") move with the clock, not with content.
  const fp = fingerprint({
    ...next,
    // Not part of the payload: it only makes content edits bump the revision.
    signature,
    stashes: next.stashes.map(({ index, ref, hash, message }) => ({
      index,
      ref,
      hash,
      message,
    })),
  });
  if (fp === entry.detailFp && entry.detail) {
    entry.detail = { ...entry.detail, stashes: next.stashes };
    return false;
  }
  const changed = fp !== entry.detailFp;
  entry.detailFp = fp;
  entry.detail = {
    projectId: project.projectId,
    repo: entry.repo,
    // A changed detail gets the new project revision on emit.
    revision: entry.detailRevision ?? project.revision,
    ...next,
    stale: false,
  };
  return changed;
}

/** Most changed files whose size and mtime are sampled per read. */
const SIGNATURE_FILE_LIMIT = 200;

/**
 * Size and mtime of the changed files: an edit of an already-modified file
 * leaves the status list unchanged, but must still move the detail revision so
 * open diffs reload.
 */
export async function statSignature(
  repoDir: string,
  paths: readonly string[],
): Promise<string> {
  const parts = await Promise.all(
    paths.slice(0, SIGNATURE_FILE_LIMIT).map(async (path) => {
      try {
        const stat = await lstat(join(repoDir, path));
        return `${path}:${stat.size}:${Math.trunc(stat.mtimeMs)}`;
      } catch {
        return `${path}:-`;
      }
    }),
  );
  return parts.join("\n");
}
