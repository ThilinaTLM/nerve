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
    type: "filesystem.project.changed" | "git.repository.invalidated",
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
  readonly #projectsByOwner = new Map<string, ProjectDemand>();
  readonly #repositoriesByOwner = new Map<string, RepositoryDemand>();
  readonly #projects = new Map<string, ProjectResource>();
  readonly #repositories = new Map<string, RepositoryResource>();
  #monitor?: NativeChangeMonitorPort;
  #operationTail: Promise<void> = Promise.resolve();
  #closed = false;

  constructor(
    readonly publisher: WorkspaceMonitorPublisher,
    options: {
      monitor?: NativeChangeMonitorPort;
      onWarning?: (message: string, error: unknown) => void;
      onRepositoryChanged?: (repoDir: string) => void;
    } = {},
  ) {
    this.options = options;
    this.#monitor = options.monitor;
  }

  readonly options: {
    monitor?: NativeChangeMonitorPort;
    onWarning?: (message: string, error: unknown) => void;
    onRepositoryChanged?: (repoDir: string) => void;
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
    this.#projectsByOwner.set(owner, {
      projectId,
      projectDir: normalized.root,
      directories: normalized.directories,
    });
    const states = await this.#rebuildProjects();
    const resource = this.#projects.get(projectId);
    const state = states.get(projectId);
    return {
      active: Boolean(resource),
      degraded: state?.degraded ?? false,
      watchedDirectoryCount: state?.watchedPaths ?? 0,
    };
  }

  clearProject(owner: string): Promise<void> {
    return this.#enqueue(() => this.#clearProject(owner));
  }

  async #clearProject(owner: string): Promise<void> {
    if (!this.#projectsByOwner.delete(owner)) return;
    await this.#rebuildProjects();
  }

  syncRepository(
    owner: string,
    projectId: string,
    repo: string,
    repoDir: string,
    active: boolean,
  ): Promise<{ active: boolean; degraded: boolean }> {
    return this.#enqueue(() =>
      this.#syncRepository(owner, projectId, repo, repoDir, active),
    );
  }

  async #syncRepository(
    owner: string,
    projectId: string,
    repo: string,
    repoDir: string,
    active: boolean,
  ): Promise<{ active: boolean; degraded: boolean }> {
    this.#assertOpen();
    if (!active) {
      await this.#clearRepository(owner);
      return { active: false, degraded: false };
    }
    const canonical = await realpath(repoDir);
    this.#repositoriesByOwner.set(owner, {
      projectId,
      repo,
      repoDir: canonical,
    });
    const states = await this.#rebuildRepositories();
    const resource = this.#repositories.get(repositoryKey(projectId, repo));
    if (!resource) return { active: false, degraded: false };
    const state = states.get(repositoryKey(projectId, repo));
    if (!state) return { active: false, degraded: false };
    return { active: true, degraded: state.degraded };
  }

  clearRepository(owner: string): Promise<void> {
    return this.#enqueue(() => this.#clearRepository(owner));
  }

  async #clearRepository(owner: string): Promise<void> {
    if (!this.#repositoriesByOwner.delete(owner)) return;
    await this.#rebuildRepositories();
  }

  requestProjectRefresh(projectId: string): Promise<number> {
    return this.#enqueue(() =>
      this.#native().requestRefresh(projectScopeId(projectId)),
    );
  }

  requestRepositoryRefresh(projectId: string, repo: string): Promise<number> {
    return this.#enqueue(() =>
      this.#native().requestRefresh(repositoryScopeId(projectId, repo)),
    );
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
    for (const [owner, demand] of this.#projectsByOwner) {
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
    for (const projectId of previous)
      await this.#native().remove(projectScopeId(projectId));
    const states = new Map<string, MonitorScopeState>();
    for (const resource of this.#projects.values())
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
    return states;
  }

  async #rebuildRepositories(): Promise<Map<string, MonitorScopeState>> {
    const previous = new Set(this.#repositories.keys());
    this.#repositories.clear();
    for (const [owner, demand] of this.#repositoriesByOwner) {
      const key = repositoryKey(demand.projectId, demand.repo);
      const resource = this.#repositories.get(key) ?? {
        ...demand,
        owners: new Set<string>(),
      };
      resource.owners.add(owner);
      this.#repositories.set(key, resource);
      previous.delete(key);
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
    this.#monitor ??= new ChangeMonitor((notice) => this.#onNotice(notice));
    return this.#monitor;
  }

  #onNotice(notice: ChangeNotice): void {
    const project = [...this.#projects.values()].find(
      (resource) => projectScopeId(resource.projectId) === notice.scopeId,
    );
    if (project) {
      const directories = notice.fullRefreshRequired
        ? []
        : changedDirectories(project.projectDir, notice.paths);
      this.publisher.publishBestEffort(
        "filesystem.project.changed",
        {
          projectId: project.projectId,
          generation: notice.generation,
          directories,
          fullRefreshRequired: notice.fullRefreshRequired,
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
    try {
      this.options.onRepositoryChanged?.(repository.repoDir);
      this.publisher.publishBestEffort(
        "git.repository.invalidated",
        {
          projectId: repository.projectId,
          repo: repository.repo,
          generation: notice.generation,
          fullRefreshRequired: notice.fullRefreshRequired,
        },
        "workspace monitor",
      );
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

function repositoryKey(projectId: string, repo: string): string {
  return JSON.stringify([projectId, repo]);
}
