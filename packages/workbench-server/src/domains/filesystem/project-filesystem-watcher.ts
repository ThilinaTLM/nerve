import { watch as watchFs, type FSWatcher, type WatchOptions } from "node:fs";
import { normalize, sep } from "node:path";

export type ProjectFilesystemChange = {
  readonly projectId: string;
  readonly source: "filesystem";
};

export interface ProjectFilesystemChangePublisher {
  publishBestEffort(
    type: "filesystem.project.changed",
    data: ProjectFilesystemChange,
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

type WatchedProject = {
  projectId: string;
  projectDir: string;
  touchedAt: number;
  watcher: FSWatcher;
  quietTimer?: ReturnType<typeof setTimeout>;
  maxTimer?: ReturnType<typeof setTimeout>;
};

export type ProjectFilesystemWatcherOptions = {
  readonly watch?: WatchFunction;
  readonly clock?: Clock;
  readonly now?: () => number;
  readonly quietMs?: number;
  readonly maxWaitMs?: number;
  readonly maxProjects?: number;
  readonly onWarning?: (message: string, error: unknown) => void;
};

const systemClock: Clock = {
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimeout: (timer) => clearTimeout(timer),
};

export class ProjectFilesystemWatcher {
  readonly #entries = new Map<string, WatchedProject>();
  readonly #watch: WatchFunction;
  readonly #clock: Clock;
  readonly #now: () => number;
  readonly #quietMs: number;
  readonly #maxWaitMs: number;
  readonly #maxProjects: number;
  #closed = false;

  constructor(
    readonly publisher: ProjectFilesystemChangePublisher,
    readonly options: ProjectFilesystemWatcherOptions = {},
  ) {
    this.#watch = options.watch ?? watchFs;
    this.#clock = options.clock ?? systemClock;
    this.#now = options.now ?? Date.now;
    this.#quietMs = options.quietMs ?? 300;
    this.#maxWaitMs = options.maxWaitMs ?? 2_000;
    this.#maxProjects = options.maxProjects ?? 16;
  }

  watch(projectId: string, projectDir: string): void {
    if (this.#closed) return;
    const existing = this.#entries.get(projectId);
    if (existing?.projectDir === projectDir) {
      existing.touchedAt = this.#now();
      return;
    }
    if (existing) this.#remove(projectId, existing);

    try {
      const watcher = this.#watch(
        projectDir,
        { recursive: true, persistent: false },
        (_eventType, filename) => {
          if (shouldInvalidateProjectPath(filename))
            this.#invalidate(projectId);
        },
      );
      const entry: WatchedProject = {
        projectId,
        projectDir,
        touchedAt: this.#now(),
        watcher,
      };
      watcher.on("error", (error) => {
        this.options.onWarning?.("Project filesystem watcher failed", error);
        if (this.#entries.get(projectId) === entry)
          this.#remove(projectId, entry);
      });
      this.#entries.set(projectId, entry);
      this.#evictOverflow();
    } catch (error) {
      this.options.onWarning?.("Could not watch project filesystem", error);
    }
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    for (const [projectId, entry] of this.#entries)
      this.#remove(projectId, entry);
  }

  #invalidate(projectId: string): void {
    const entry = this.#entries.get(projectId);
    if (this.#closed || !entry) return;
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

  #flush(entry: WatchedProject): void {
    if (entry.quietTimer) this.#clock.clearTimeout(entry.quietTimer);
    if (entry.maxTimer) this.#clock.clearTimeout(entry.maxTimer);
    entry.quietTimer = undefined;
    entry.maxTimer = undefined;
    if (this.#closed || this.#entries.get(entry.projectId) !== entry) return;
    try {
      this.publisher.publishBestEffort(
        "filesystem.project.changed",
        { projectId: entry.projectId, source: "filesystem" },
        "project filesystem watcher",
      );
    } catch (error) {
      this.options.onWarning?.(
        "Could not publish project filesystem change",
        error,
      );
    }
  }

  #evictOverflow(): void {
    while (this.#entries.size > this.#maxProjects) {
      const oldest = [...this.#entries.entries()].sort(
        ([, left], [, right]) => left.touchedAt - right.touchedAt,
      )[0];
      if (!oldest) return;
      this.#remove(oldest[0], oldest[1]);
    }
  }

  #remove(projectId: string, entry: WatchedProject): void {
    if (entry.quietTimer) this.#clock.clearTimeout(entry.quietTimer);
    if (entry.maxTimer) this.#clock.clearTimeout(entry.maxTimer);
    entry.watcher.close();
    this.#entries.delete(projectId);
  }
}

function pathText(filename: string | Buffer | null): string | undefined {
  if (filename === null) return undefined;
  return normalize(filename.toString()).split(sep).join("/");
}

export function shouldInvalidateProjectPath(
  filename: string | Buffer | null,
): boolean {
  const path = pathText(filename);
  if (path === undefined || path === ".git") return true;
  if (!path.startsWith(".git/")) return true;
  const gitPath = path.slice(5);
  if (gitPath.endsWith(".lock")) return false;
  return (
    gitPath === "HEAD" ||
    gitPath === "index" ||
    gitPath === "packed-refs" ||
    gitPath === "config" ||
    gitPath === "MERGE_HEAD" ||
    gitPath === "CHERRY_PICK_HEAD" ||
    gitPath === "REVERT_HEAD" ||
    gitPath.startsWith("refs/") ||
    gitPath.startsWith("rebase-") ||
    gitPath.startsWith("sequencer/") ||
    gitPath.startsWith("BISECT_")
  );
}
