import { remoteRefBranches } from "../git/pr-sync/pr-remote-ref-signal.js";
import { lstat, realpath } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import {
  ChangeMonitor,
  type ChangeNotice,
  type MonitorDiagnostics,
  type MonitorScopeState,
} from "@nervekit/native";

export interface WorkspaceMonitorPublisher {
  publishBestEffort(
    type: "filesystem.project.changed",
    data: Record<string, unknown>,
    context: string,
  ): void;
}

export interface NativeChangeMonitorPort {
  syncDirectories(input: {
    id: string;
    paths: string[];
    pollIntervalMs?: number;
  }): Promise<MonitorScopeState>;
  /** Recursive, ignore-filtered project watching; absent on monitors without it. */
  syncTree?(input: {
    id: string;
    root: string;
    pollIntervalMs?: number;
  }): Promise<MonitorScopeState>;
  syncGit(input: {
    id: string;
    repository: string;
    pollIntervalMs?: number;
  }): Promise<MonitorScopeState>;
  requestRefresh(scopeId: string): Promise<number>;
  remove(scopeId: string): Promise<void>;
  diagnostics(): MonitorDiagnostics;
  close(): Promise<void>;
}

export interface WorkspaceRefreshOptions {
  refreshCause?: "uncertain_poll";
}

export interface WorkspaceNoticeOptions extends WorkspaceRefreshOptions {
  /** The notice touched the shared Git directory's `worktrees/` entries. */
  worktreesChanged?: boolean;
}

/** `<commondir>/worktrees/...` changed: a linked worktree was added, moved or removed. */
export function touchesWorktreeEntries(paths: readonly string[]): boolean {
  return paths.some((path) => /(?:^|[\\/])worktrees(?:[\\/]|$)/.test(path));
}

/** A Git poll means a proven fingerprint change; directory polling does not. */
export function workspaceRefreshCause(
  kind: "git" | "directory",
  causes: ChangeNotice["causes"],
): WorkspaceRefreshOptions["refreshCause"] {
  return causes.length > 0 &&
    causes.every(
      (cause) =>
        cause === "poll_error" || (kind === "directory" && cause === "poll"),
    )
    ? "uncertain_poll"
    : undefined;
}

type ProjectDemand = {
  projectId: string;
  projectDir: string;
  directories: string[];
};

type RepositoryDemand = {
  projectId: string;
  repo: string;
  repoDir: string;
};

type ProjectResource = {
  projectId: string;
  projectDir: string;
  owners: Set<string>;
  directories: Set<string>;
};

type RepositoryResource = RepositoryDemand & { owners: Set<string> };

export class WorkspaceMonitor {
  readonly #projectsByOwner = new Map<string, Map<string, ProjectDemand>>();
  readonly #repositoriesByOwner = new Map<
    string,
    Map<string, RepositoryDemand>
  >();
  readonly #projects = new Map<string, ProjectResource>();
  /** Projects whose scope is a reliable recursive tree watch (poll is only a safety net). */
  readonly #treeProjects = new Set<string>();
  #treeUnavailable = false;
  readonly #repositories = new Map<string, RepositoryResource>();
  #monitor?: NativeChangeMonitorPort;
  #operationTail: Promise<void> = Promise.resolve();
  #closed = false;

  constructor(
    readonly publisher: WorkspaceMonitorPublisher,
    options: {
      monitor?: NativeChangeMonitorPort;
      createMonitor?: (
        onNotice: (notice: ChangeNotice) => void,
      ) => NativeChangeMonitorPort;
      onWarning?: (message: string, error: unknown) => void;
      /**
       * Project files changed. `changedPaths` are project-relative ("/" separators);
       * `undefined` means unknown (rescan everything). Feeds the native path index.
       */
      onProjectChanged?: (
        projectId: string,
        changedPaths: string[] | undefined,
      ) => void;
      onRemoteRefsChanged?: (
        projectId: string,
        repo: string,
        branches: string[],
      ) => void;
      onRepositoryChanged?: (
        repoDir: string,
        options?: WorkspaceRefreshOptions,
      ) => void;
      /** A watched repository scope reported a notice (workspace sync marks it dirty). */
      onRepositoryNotice?: (
        projectId: string,
        repo: string,
        options?: WorkspaceNoticeOptions,
      ) => void;
    } = {},
  ) {
    this.options = options;
    this.#monitor = options.monitor;
  }

  readonly options: {
    monitor?: NativeChangeMonitorPort;
    createMonitor?: (
      onNotice: (notice: ChangeNotice) => void,
    ) => NativeChangeMonitorPort;
    onWarning?: (message: string, error: unknown) => void;
    onProjectChanged?: (
      projectId: string,
      changedPaths: string[] | undefined,
    ) => void;
    onRemoteRefsChanged?: (
      projectId: string,
      repo: string,
      branches: string[],
    ) => void;
    onRepositoryChanged?: (
      repoDir: string,
      options?: WorkspaceRefreshOptions,
    ) => void;
    onRepositoryNotice?: (
      projectId: string,
      repo: string,
      options?: WorkspaceNoticeOptions,
    ) => void;
  };

  syncProject(
    owner: string,
    projectId: string,
    projectDir: string,
    directories: readonly string[],
  ): Promise<{
    active: boolean;
    degraded: boolean;
    watchedDirectoryCount: number;
  }> {
    return this.#enqueue(() =>
      this.#syncProject(owner, projectId, projectDir, directories),
    );
  }

  async #syncProject(
    owner: string,
    projectId: string,
    projectDir: string,
    directories: readonly string[],
  ): Promise<{
    active: boolean;
    degraded: boolean;
    watchedDirectoryCount: number;
  }> {
    this.#assertOpen();
    const normalized = await normalizeDirectories(projectDir, directories);
    const demands = this.#projectsByOwner.get(owner) ?? new Map();
    demands.set(projectId, {
      projectId,
      projectDir: normalized.root,
      directories: normalized.directories,
    });
    this.#projectsByOwner.set(owner, demands);
    const states = await this.#rebuildProjects();
    const resource = this.#projects.get(projectId);
    const state = states.get(projectId);
    return {
      active: Boolean(resource),
      degraded: state?.degraded ?? false,
      watchedDirectoryCount: state?.watchedPaths ?? 0,
    };
  }

  clearProject(owner: string, projectId: string): Promise<void> {
    return this.#enqueue(() => this.#clearProject(owner, projectId));
  }

  async #clearProject(owner: string, projectId: string): Promise<void> {
    const demands = this.#projectsByOwner.get(owner);
    if (!demands?.delete(projectId)) return;
    if (demands.size === 0) this.#projectsByOwner.delete(owner);
    await this.#rebuildProjects();
  }

  /**
   * Replace the owner's workspace repository watches for one project in a
   * single rebuild. Reports per repository whether the scope is degraded.
   */
  setRepositories(
    owner: string,
    projectId: string,
    repos: ReadonlyArray<{ repo: string; repoDir: string }>,
  ): Promise<Map<string, { degraded: boolean }>> {
    return this.#enqueue(async () => {
      this.#assertOpen();
      const demands = this.#repositoriesByOwner.get(owner) ?? new Map();
      for (const [key, demand] of demands)
        if (demand.projectId === projectId) demands.delete(key);
      const resolved: RepositoryDemand[] = [];
      for (const { repo, repoDir } of repos) {
        try {
          resolved.push({ projectId, repo, repoDir: await realpath(repoDir) });
        } catch {
          /* A vanished repository is simply not watched. */
        }
      }
      for (const demand of resolved)
        demands.set(repositoryKey(projectId, demand.repo), demand);
      if (demands.size) this.#repositoriesByOwner.set(owner, demands);
      else this.#repositoriesByOwner.delete(owner);
      const states = await this.#rebuildRepositories();
      const result = new Map<string, { degraded: boolean }>();
      for (const demand of resolved) {
        const state = states.get(repositoryKey(projectId, demand.repo));
        if (state) result.set(demand.repo, { degraded: state.degraded });
      }
      return result;
    });
  }

  /** Drop every repository watch the owner holds for the project. */
  clearRepositories(owner: string, projectId: string): Promise<void> {
    return this.#enqueue(async () => {
      const demands = this.#repositoriesByOwner.get(owner);
      if (!demands) return;
      let removed = false;
      for (const [key, demand] of demands)
        if (demand.projectId === projectId)
          removed = demands.delete(key) || removed;
      if (demands.size === 0) this.#repositoriesByOwner.delete(owner);
      if (removed) await this.#rebuildRepositories();
    });
  }

  /** Re-scan a monitored project; reports inactive instead of failing when no client monitors it. */
  requestProjectRefresh(projectId: string): Promise<MonitorRefreshOutcome> {
    return this.#enqueue(async () => {
      this.#assertOpen();
      if (!this.#projects.has(projectId)) return inactiveRefresh();
      return {
        active: true,
        generation: await this.#native().requestRefresh(
          projectScopeId(projectId),
        ),
      };
    });
  }

  releaseOwner(owner: string): Promise<void> {
    return this.#enqueue(() => this.#releaseOwner(owner));
  }

  async #releaseOwner(owner: string): Promise<void> {
    const project = this.#projectsByOwner.delete(owner);
    const repository = this.#repositoriesByOwner.delete(owner);
    if (project) await this.#rebuildProjects();
    if (repository) await this.#rebuildRepositories();
  }

  diagnostics(): MonitorDiagnostics {
    return this.#monitor?.diagnostics() ?? emptyDiagnostics();
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    await this.#operationTail;
    this.#closed = true;
    this.#projectsByOwner.clear();
    this.#repositoriesByOwner.clear();
    this.#projects.clear();
    this.#repositories.clear();
    await this.#monitor?.close();
    this.#monitor = undefined;
  }

  async #rebuildProjects(): Promise<Map<string, MonitorScopeState>> {
    const previous = new Set(this.#projects.keys());
    this.#projects.clear();
    for (const [owner, demands] of this.#projectsByOwner) {
      for (const demand of demands.values()) {
        const resource = this.#projects.get(demand.projectId) ?? {
          projectId: demand.projectId,
          projectDir: demand.projectDir,
          owners: new Set<string>(),
          directories: new Set<string>(),
        };
        resource.owners.add(owner);
        for (const directory of demand.directories)
          resource.directories.add(directory);
        this.#projects.set(demand.projectId, resource);
        previous.delete(demand.projectId);
      }
    }
    for (const projectId of previous)
      await this.#native().remove(projectScopeId(projectId));
    const states = new Map<string, MonitorScopeState>();
    this.#treeProjects.clear();
    for (const resource of this.#projects.values()) {
      const tree = await this.#syncTree(resource);
      if (tree) {
        states.set(resource.projectId, tree);
        if (!tree.degraded) this.#treeProjects.add(resource.projectId);
        continue;
      }
      states.set(
        resource.projectId,
        await this.#native().syncDirectories({
          id: projectScopeId(resource.projectId),
          paths: [...resource.directories].map((path) =>
            path ? resolve(resource.projectDir, path) : resource.projectDir,
          ),
          pollIntervalMs: 20_000,
        }),
      );
    }
    return states;
  }

  /** Recursive ignore-filtered watch when the native monitor supports it. */
  async #syncTree(
    resource: ProjectResource,
  ): Promise<MonitorScopeState | undefined> {
    const monitor = this.#native();
    if (
      this.#treeUnavailable ||
      typeof monitor.syncTree !== "function" ||
      (monitor instanceof ChangeMonitor && !ChangeMonitor.supportsTreeScopes())
    )
      return undefined;
    try {
      return await monitor.syncTree({
        id: projectScopeId(resource.projectId),
        root: resource.projectDir,
        pollIntervalMs: 20_000,
      });
    } catch (error) {
      this.#treeUnavailable = true;
      this.options.onWarning?.(
        "Recursive project watching unavailable; using per-directory watches",
        error,
      );
      return undefined;
    }
  }

  async #rebuildRepositories(): Promise<Map<string, MonitorScopeState>> {
    const previous = new Set(this.#repositories.keys());
    this.#repositories.clear();
    for (const [owner, demands] of this.#repositoriesByOwner) {
      for (const demand of demands.values()) {
        const key = repositoryKey(demand.projectId, demand.repo);
        const resource = this.#repositories.get(key) ?? {
          ...demand,
          owners: new Set<string>(),
        };
        resource.owners.add(owner);
        this.#repositories.set(key, resource);
        previous.delete(key);
      }
    }
    for (const key of previous) {
      const [projectId, repo] = JSON.parse(key) as [string, string];
      await this.#native().remove(repositoryScopeId(projectId, repo));
    }
    const states = new Map<string, MonitorScopeState>();
    for (const resource of this.#repositories.values())
      states.set(
        repositoryKey(resource.projectId, resource.repo),
        await this.#native().syncGit({
          id: repositoryScopeId(resource.projectId, resource.repo),
          repository: resource.repoDir,
          pollIntervalMs: 10_000,
        }),
      );
    return states;
  }

  #enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#operationTail.then(operation, operation);
    this.#operationTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  #native(): NativeChangeMonitorPort {
    this.#assertOpen();
    this.#monitor ??=
      this.options.createMonitor?.((notice) => this.#onNotice(notice)) ??
      new ChangeMonitor((notice) => this.#onNotice(notice));
    return this.#monitor;
  }

  #onNotice(notice: ChangeNotice): void {
    const project = [...this.#projects.values()].find(
      (resource) => projectScopeId(resource.projectId) === notice.scopeId,
    );
    if (project) {
      const refreshCause = workspaceRefreshCause("directory", notice.causes);
      const directories = notice.fullRefreshRequired
        ? []
        : changedDirectories(project.projectDir, notice.paths);
      try {
        // A directory-poll safety net on a healthy tree watch proves nothing changed.
        if (!(refreshCause && this.#treeProjects.has(project.projectId))) {
          const changed = notice.fullRefreshRequired
            ? undefined
            : projectRelativePaths(project.projectDir, notice.paths);
          if (!changed || changed.length > 0)
            this.options.onProjectChanged?.(project.projectId, changed);
        }
      } catch (error) {
        this.options.onWarning?.("Could not update project path index", error);
      }
      this.publisher.publishBestEffort(
        "filesystem.project.changed",
        {
          projectId: project.projectId,
          generation: notice.generation,
          directories,
          fullRefreshRequired: notice.fullRefreshRequired,
          ...(refreshCause ? { refreshCause } : {}),
        },
        "workspace monitor",
      );
      return;
    }
    const repository = [...this.#repositories.values()].find(
      (resource) =>
        repositoryScopeId(resource.projectId, resource.repo) === notice.scopeId,
    );
    if (!repository) return;
    const branches = remoteRefBranches(notice.paths);
    if (
      branches !== null ||
      (notice.fullRefreshRequired &&
        workspaceRefreshCause("git", notice.causes) !== "uncertain_poll")
    )
      this.options.onRemoteRefsChanged?.(
        repository.projectId,
        repository.repo,
        branches ?? [],
      );
    try {
      const refreshCause = workspaceRefreshCause("git", notice.causes);
      this.options.onRepositoryChanged?.(
        repository.repoDir,
        refreshCause ? { refreshCause } : undefined,
      );
      const worktreesChanged = touchesWorktreeEntries(notice.paths);
      this.options.onRepositoryNotice?.(repository.projectId, repository.repo, {
        ...(refreshCause ? { refreshCause } : {}),
        ...(worktreesChanged ? { worktreesChanged } : {}),
      });
    } catch (error) {
      this.options.onWarning?.("Could not publish workspace change", error);
    }
  }

  #assertOpen(): void {
    if (this.#closed) throw new Error("Workspace monitor is closed");
  }
}

async function normalizeDirectories(
  projectDir: string,
  directories: readonly string[],
): Promise<{ root: string; directories: string[] }> {
  const root = await realpath(projectDir);
  const normalized = new Set<string>([""]);
  for (const raw of directories) {
    const value = raw
      .replaceAll("\\", "/")
      .replace(/^\.\/?/, "")
      .replace(/\/$/, "");
    const target = resolve(root, value || ".");
    const rel = relative(root, target);
    if (
      rel === ".." ||
      rel.startsWith(`..${sep}`) ||
      resolve(root, rel) !== target
    )
      throw new Error("Monitor directory escapes the project root");
    try {
      const canonical = await realpath(target);
      const canonicalRelative = relative(root, canonical);
      if (
        canonicalRelative === ".." ||
        canonicalRelative.startsWith(`..${sep}`)
      )
        throw new Error("Monitor directory escapes the project root");
      const info = await lstat(target);
      if (!info.isDirectory() || info.isSymbolicLink()) continue;
      normalized.add(canonicalRelative.split(sep).join("/"));
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        (error.code === "ENOENT" || error.code === "ENOTDIR")
      )
        continue;
      throw error;
    }
  }
  return { root, directories: [...normalized] };
}

function changedDirectories(root: string, paths: readonly string[]): string[] {
  const result = new Set<string>();
  for (const path of paths) {
    const directory = dirname(path);
    const value = relative(root, directory);
    if (value === ".." || value.startsWith(`..${sep}`)) continue;
    result.add(value === "." ? "" : value.split(sep).join("/"));
  }
  return [...result].slice(0, 256);
}

function projectRelativePaths(
  root: string,
  paths: readonly string[],
): string[] {
  const result: string[] = [];
  for (const path of paths) {
    const value = relative(root, path);
    if (value === "" || value === ".." || value.startsWith(`..${sep}`))
      continue;
    result.push(value.split(sep).join("/"));
  }
  return result;
}

function emptyDiagnostics(): MonitorDiagnostics {
  return {
    activeScopes: 0,
    registrations: 0,
    degradedScopes: 0,
    emittedNotices: 0,
    coalescedTriggers: 0,
    overflows: 0,
    pollCount: 0,
    pollFailures: 0,
  };
}

function projectScopeId(projectId: string): string {
  return `project:${projectId}`;
}

function repositoryScopeId(projectId: string, repo: string): string {
  return `git:${repositoryKey(projectId, repo)}`;
}

interface MonitorRefreshOutcome {
  active: boolean;
  generation: number;
}

function inactiveRefresh(): MonitorRefreshOutcome {
  return { active: false, generation: 0 };
}

function repositoryKey(projectId: string, repo: string): string {
  return JSON.stringify([projectId, repo]);
}
