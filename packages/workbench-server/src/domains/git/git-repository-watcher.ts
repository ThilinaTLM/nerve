import {
  readFileSync,
  watch as watchFs,
  type FSWatcher,
  type WatchOptions,
} from "node:fs";
import { dirname, isAbsolute, join, normalize, resolve, sep } from "node:path";
import type { PerformanceDiagnosticsPort } from "../../core/ports.js";

export type GitRepositoryInvalidation = {
  readonly projectId: string;
  readonly repo: string;
  readonly source: "filesystem";
};

export interface GitRepositoryInvalidationPublisher {
  publishBestEffort(
    type: "git.repository.invalidated",
    data: GitRepositoryInvalidation,
    context: string,
  ): void;
}

type WatchListener = (
  eventType: string,
  filename: string | Buffer | null,
) => void;
type WatchFunction = (
  path: string,
  options: WatchOptions,
  listener: WatchListener,
) => FSWatcher;

type Clock = {
  setTimeout(
    callback: () => void,
    delayMs: number,
  ): ReturnType<typeof setTimeout>;
  clearTimeout(timer: ReturnType<typeof setTimeout>): void;
};

type WatchedRepository = {
  projectId: string;
  repo: string;
  repoDir: string;
  touchedAt: number;
  watchers: FSWatcher[];
  quietTimer?: ReturnType<typeof setTimeout>;
  maxTimer?: ReturnType<typeof setTimeout>;
  metadataChanged: boolean;
};

export type GitRepositoryWatcherOptions = {
  readonly watch?: WatchFunction;
  readonly clock?: Clock;
  readonly now?: () => number;
  readonly quietMs?: number;
  readonly maxWaitMs?: number;
  readonly maxRepositories?: number;
  readonly diagnostics?: PerformanceDiagnosticsPort;
  readonly onWarning?: (message: string, error: unknown) => void;
  readonly onRepositoryMetadataChanged?: (repoDir: string) => void;
};

const systemClock: Clock = {
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimeout: (timer) => clearTimeout(timer),
};

export class GitRepositoryWatcher {
  readonly #entries = new Map<string, WatchedRepository>();
  readonly #watch: WatchFunction;
  readonly #clock: Clock;
  readonly #now: () => number;
  readonly #quietMs: number;
  readonly #maxWaitMs: number;
  readonly #maxRepositories: number;
  #closed = false;

  constructor(
    readonly publisher: GitRepositoryInvalidationPublisher,
    readonly options: GitRepositoryWatcherOptions = {},
  ) {
    this.#watch = options.watch ?? watchFs;
    this.#clock = options.clock ?? systemClock;
    this.#now = options.now ?? Date.now;
    this.#quietMs = options.quietMs ?? 300;
    this.#maxWaitMs = options.maxWaitMs ?? 2_000;
    this.#maxRepositories = options.maxRepositories ?? 16;
  }

  watch(projectId: string, repo: string, repoDir: string): void {
    if (this.#closed) return;
    const key = repositoryKey(projectId, repo);
    const existing = this.#entries.get(key);
    if (existing?.repoDir === repoDir) {
      existing.touchedAt = this.#now();
      return;
    }
    if (existing) this.#remove(key, existing);

    const entry: WatchedRepository = {
      projectId,
      repo,
      repoDir,
      touchedAt: this.#now(),
      watchers: [],
      metadataChanged: false,
    };
    try {
      entry.watchers.push(
        this.#watch(
          repoDir,
          { recursive: true, persistent: false },
          (_eventType, filename) => {
            this.options.diagnostics?.count("git.filesystemEvent");
            const change = classifyWorktreePath(filename);
            if (change) this.#invalidate(entry, change === "metadata");
          },
        ),
      );
      for (const gitDir of externalGitDirs(repoDir)) {
        entry.watchers.push(
          this.#watch(
            gitDir,
            { recursive: true, persistent: false },
            (_eventType, filename) => {
              this.options.diagnostics?.count("git.filesystemEvent");
              if (relevantGitPath(filename)) this.#invalidate(entry, true);
            },
          ),
        );
      }
      this.options.diagnostics?.count(
        "git.watcherCreated",
        entry.watchers.length,
      );
      for (const watcher of entry.watchers) {
        watcher.on("error", (error) => {
          this.options.onWarning?.("Git repository watcher failed", error);
          if (this.#entries.get(key) === entry) this.#remove(key, entry);
        });
      }
      this.#entries.set(key, entry);
      this.#evictOverflow();
    } catch (error) {
      closeWatchers(entry.watchers);
      this.options.onWarning?.("Could not watch Git repository", error);
    }
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    for (const [key, entry] of this.#entries) this.#remove(key, entry);
  }

  #invalidate(entry: WatchedRepository, metadataChanged: boolean): void {
    if (
      this.#closed ||
      !this.#entries.has(repositoryKey(entry.projectId, entry.repo))
    )
      return;
    entry.metadataChanged ||= metadataChanged;
    if (entry.quietTimer) this.#clock.clearTimeout(entry.quietTimer);
    entry.quietTimer = this.#clock.setTimeout(
      () => this.#flush(entry),
      this.#quietMs,
    );
    entry.maxTimer ??= this.#clock.setTimeout(
      () => this.#flush(entry),
      this.#maxWaitMs,
    );
  }

  #flush(entry: WatchedRepository): void {
    if (entry.quietTimer) this.#clock.clearTimeout(entry.quietTimer);
    if (entry.maxTimer) this.#clock.clearTimeout(entry.maxTimer);
    entry.quietTimer = undefined;
    entry.maxTimer = undefined;
    const metadataChanged = entry.metadataChanged;
    entry.metadataChanged = false;
    if (
      this.#closed ||
      !this.#entries.has(repositoryKey(entry.projectId, entry.repo))
    )
      return;
    try {
      this.options.diagnostics?.count("git.invalidation");
      if (metadataChanged) {
        this.options.diagnostics?.count("git.metadataInvalidation");
        this.options.onRepositoryMetadataChanged?.(entry.repoDir);
      }
      this.publisher.publishBestEffort(
        "git.repository.invalidated",
        {
          projectId: entry.projectId,
          repo: entry.repo,
          source: "filesystem",
        },
        "git repository watcher",
      );
    } catch (error) {
      this.options.onWarning?.("Could not publish Git invalidation", error);
    }
  }

  #evictOverflow(): void {
    while (this.#entries.size > this.#maxRepositories) {
      const oldest = [...this.#entries.entries()].sort(
        ([, left], [, right]) => left.touchedAt - right.touchedAt,
      )[0];
      if (!oldest) return;
      this.options.diagnostics?.count("git.watcherEvicted");
      this.#remove(oldest[0], oldest[1]);
    }
  }

  #remove(key: string, entry: WatchedRepository): void {
    if (entry.quietTimer) this.#clock.clearTimeout(entry.quietTimer);
    if (entry.maxTimer) this.#clock.clearTimeout(entry.maxTimer);
    closeWatchers(entry.watchers);
    this.#entries.delete(key);
  }
}

function repositoryKey(projectId: string, repo: string): string {
  return JSON.stringify([projectId, repo]);
}

function closeWatchers(watchers: readonly FSWatcher[]): void {
  for (const watcher of watchers) watcher.close();
}

function pathText(filename: string | Buffer | null): string | undefined {
  if (filename === null) return undefined;
  return normalize(filename.toString()).split(sep).join("/");
}

function classifyWorktreePath(
  filename: string | Buffer | null,
): "worktree" | "metadata" | undefined {
  const path = pathText(filename);
  if (path === undefined || path === ".git") return "metadata";
  if (!path.startsWith(".git/")) return "worktree";
  return relevantGitPath(path.slice(5)) ? "metadata" : undefined;
}

function relevantGitPath(filename: string | Buffer | null): boolean {
  const path = pathText(filename);
  if (path === undefined) return true;
  if (path.endsWith(".lock")) return false;
  if (
    path === "HEAD" ||
    path === "index" ||
    path === "packed-refs" ||
    path === "config" ||
    path === "MERGE_HEAD" ||
    path === "CHERRY_PICK_HEAD" ||
    path === "REVERT_HEAD"
  )
    return true;
  return (
    path.startsWith("refs/") ||
    path.startsWith("rebase-") ||
    path.startsWith("sequencer/") ||
    path.startsWith("BISECT_")
  );
}

function externalGitDirs(repoDir: string): string[] {
  const dotGit = join(repoDir, ".git");
  try {
    const firstLine = readFileSync(dotGit, "utf8").split(/\r?\n/, 1)[0]?.trim();
    if (!firstLine?.toLowerCase().startsWith("gitdir:")) return [];
    const value = firstLine.slice("gitdir:".length).trim();
    if (!value) return [];
    const gitDir = isAbsolute(value)
      ? normalize(value)
      : resolve(dirname(dotGit), value);
    const commonDir = resolveCommonGitDir(gitDir);
    return commonDir && commonDir !== gitDir ? [gitDir, commonDir] : [gitDir];
  } catch {
    return [];
  }
}

function resolveCommonGitDir(gitDir: string): string | undefined {
  try {
    const value = readFileSync(join(gitDir, "commondir"), "utf8").trim();
    if (!value) return undefined;
    return isAbsolute(value) ? normalize(value) : resolve(gitDir, value);
  } catch {
    return undefined;
  }
}
