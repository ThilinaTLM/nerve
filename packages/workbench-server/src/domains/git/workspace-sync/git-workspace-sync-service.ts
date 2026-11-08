import type {
  GitDiscoveryResponse,
  GitOverviewResponse,
  GitRepoDetailSnapshot,
  GitRepoSummary,
  GitWorkspaceChangedEvent,
  GitWorkspaceSnapshot,
  GitWorkspaceWatchState,
  GitWorkspaceWatchSyncRequest,
} from "@nervekit/contracts/git";
import type { FetchCandidate } from "./git-background-fetch-policy.js";
import { MonitorDemandSync } from "./git-workspace-monitor-demand.js";
import {
  applyDetail,
  errorCategory,
  fetchCandidates,
  isSuperseded,
  projectErrors,
  projectView,
  statSignature,
  waitForRead,
  type ProjectEntry,
  type RepoEntry,
} from "./git-workspace-sync-state.js";
import {
  GitWorkspaceDemandRegistry,
  fingerprint,
  markDirty,
  GIT_WORKSPACE_STRUCTURE_CHECK_MS,
  nextUncertainPoll,
  planReads,
  repoPriority,
  summarizeDemands,
  wantsDetail,
  type ProjectDemandSummary,
  type QueueCandidate,
} from "./git-workspace-sync-policy.js";

/** Native reads the service needs; `GitService` satisfies it structurally. */
export interface GitWorkspaceReadBackend {
  discoverRepos(
    projectId: string,
    refresh?: boolean,
  ): Promise<GitDiscoveryResponse>;
  /** Full read: summary plus files and stashes (detail tier). */
  overview(projectId: string, repo: string): Promise<GitOverviewResponse>;
  /** Cheap read: summary only, no file list (summary tier). */
  repoSummary(projectId: string, repo: string): Promise<GitRepoSummary>;
  /** Repository paths a discovery would report, without status reads. */
  listRepositoryPaths?(projectId: string): Promise<string[]>;
  resolveRepoDir(projectId: string, repo: string): string;
}

/** Native change-monitor demand, per connection. `WorkspaceMonitor` satisfies it. */
export interface GitWorkspaceMonitorPort {
  /** Replace this owner's workspace repository watches for the project. */
  setRepositories(
    owner: string,
    projectId: string,
    repos: Array<{ repo: string; repoDir: string }>,
  ): Promise<Map<string, { degraded: boolean }>>;
  clearRepositories(owner: string, projectId: string): Promise<void>;
}

export interface GitWorkspacePublisher {
  publish(
    type: "git.workspace.changed",
    data: GitWorkspaceChangedEvent,
  ): unknown;
}

/** Notified when a worktree's branch changed (also on first read, `previous` undefined). */
export type GitBranchChange = {
  projectId: string;
  repo: string;
  branch: string | null;
  detached: boolean;
  previous: string | null | undefined;
};

/** Upper bound for callers waiting on a read; they then get the latest known state. */
const READ_WAIT_MS = 60_000;
const MUTATION_WAIT_MS = 10_000;
/** Consecutive superseded reads before a repository counts as failed. */
const MAX_SUPERSEDED_READS = 5;

/**
 * Server-owned Git workspace store: summaries per project and details per
 * demanded repository, with a revision that only moves when content changes.
 * Nothing is read without demand; monitor notices only mark entries dirty.
 */
export class GitWorkspaceSync {
  readonly demands = new GitWorkspaceDemandRegistry();
  readonly #projects = new Map<string, ProjectEntry>();
  readonly #monitorDemand: MonitorDemandSync;
  readonly #running = new Set<Promise<void>>();
  #timer?: ReturnType<typeof setTimeout>;
  #closed = false;

  constructor(
    readonly backend: GitWorkspaceReadBackend,
    readonly monitor: GitWorkspaceMonitorPort | undefined,
    readonly events: GitWorkspacePublisher,
    readonly options: {
      now?: () => number;
      concurrency?: number;
      /** Hook for PR sync (wave 3): a worktree's branch moved. */
      onBranchChanged?: (change: GitBranchChange) => void;
      /** Content signature of changed files; default: size and mtime. */
      fileSignature?: (
        repoDir: string,
        paths: readonly string[],
      ) => Promise<string>;
    } = {},
  ) {
    this.#monitorDemand = new MonitorDemandSync(
      backend,
      monitor,
      this.demands,
      () => this.#pump(),
    );
  }

  #now() {
    return (this.options.now ?? Date.now)();
  }

  // ── Demand ────────────────────────────────────────────────────────────

  async sync(
    owner: string,
    request: GitWorkspaceWatchSyncRequest,
  ): Promise<GitWorkspaceWatchState> {
    this.#assertOpen();
    const project = this.#project(request.projectId);
    this.demands.sync(owner, request.projectId, {
      visible: request.visible,
      detail: request.detail,
      hint: request.hint,
    });
    this.#applyDemand(project);
    this.#pump();
    const degraded = await this.#monitorDemand.sync(project);
    return { revision: project.revision, degraded };
  }

  async clear(
    owner: string,
    projectId: string,
  ): Promise<GitWorkspaceWatchState> {
    this.demands.clear(owner, projectId);
    const project = this.#projects.get(projectId);
    if (project) this.#applyDemand(project);
    this.#monitorDemand.forget(owner, projectId);
    try {
      await this.monitor?.clearRepositories(owner, projectId);
    } catch {
      /* Releasing demand cannot fail the caller. */
    }
    return { revision: project?.revision ?? 0, degraded: false };
  }

  /** Socket closed: drop demand. The native monitor releases its own owner entries. */
  releaseOwner(owner: string) {
    const projects = this.demands.projectsOf(owner);
    this.demands.clear(owner);
    this.#monitorDemand.forget(owner);
    for (const projectId of projects) {
      const project = this.#projects.get(projectId);
      if (project) this.#applyDemand(project);
    }
  }

  // ── Triggers ──────────────────────────────────────────────────────────

  /** Native monitor notice for a watched repository: marks dirty, never reads by itself. */
  onNotice(
    projectId: string,
    repo: string,
    notice: {
      refreshCause?: "uncertain_poll";
      /** The notice touched the shared Git directory's `worktrees/` entries. */
      worktreesChanged?: boolean;
    } = {},
  ) {
    const project = this.#projects.get(projectId);
    const entry = project?.repos.get(repo);
    if (!project || !entry || this.#closed) return;
    if (notice.worktreesChanged) this.#rediscover(project);
    if (notice.refreshCause === "uncertain_poll") {
      // Poll uncertainty is not evidence of a change: fall back to the slow poll.
      entry.pollUncertain = true;
    } else {
      entry.pollUncertain = false;
      this.#dirty(entry, false);
    }
    this.#pump();
  }

  /** Mark a repository dirty (remote refs moved, background fetch, ...). */
  markDirty(
    projectId: string,
    repo: string,
    options: { priority?: boolean } = {},
  ) {
    const entry = this.#projects.get(projectId)?.repos.get(repo);
    if (!entry || this.#closed) return;
    this.#dirty(entry, options.priority ?? false);
    if (options.priority) entry.mutation = true;
    this.#pump();
  }

  /** Re-discover the project (clone, worktree changes). Reads only when demanded. */
  markProjectDirty(projectId: string, options: { priority?: boolean } = {}) {
    const project = this.#projects.get(projectId);
    if (!project || this.#closed) return;
    project.discovery.dirty = markDirty(
      project.discovery.dirty,
      this.#now(),
      options.priority ?? false,
    );
    this.#pump();
  }

  /**
   * A mutation finished in `repo`: read it with top priority (when demanded).
   * Resolves with the workspace revision that includes its effect.
   */
  async mutated(projectId: string, repo: string): Promise<number> {
    const project = this.#projects.get(projectId);
    const entry = project?.repos.get(repo);
    if (!project || !entry || this.#closed) return project?.revision ?? 0;
    if (!entry.live) return project.revision;
    this.markDirty(projectId, repo, { priority: true });
    await this.#waitEntry(entry, MUTATION_WAIT_MS).catch(() => {});
    return project.revision;
  }

  /** Manual refresh. `force` bypasses debounce and waits for the reads. */
  async refresh(
    projectId: string,
    repo: string | undefined,
    force: boolean,
  ): Promise<{ revision: number }> {
    this.#assertOpen();
    const project = this.#project(projectId);
    const waits: Promise<void>[] = [];
    const now = this.#now();
    if (repo) {
      const entry = this.#entry(project, repo);
      this.#dirty(entry, force);
      if (force) waits.push(this.#waitEntry(entry));
    } else {
      project.discovery.dirty = markDirty(project.discovery.dirty, now, force);
      if (force) waits.push(this.#waitDiscovery(project));
      const demand = this.#demand(project);
      for (const entry of project.repos.values())
        if (wantsDetail(demand, entry.repo)) {
          this.#dirty(entry, force);
          if (force) waits.push(this.#waitEntry(entry));
        }
    }
    this.#pump();
    await Promise.allSettled(waits);
    return { revision: project.revision };
  }

  /** Repositories with a remote in visible projects: input for the background fetch. */
  backgroundFetchCandidates(): FetchCandidate[] {
    return fetchCandidates(
      [...this.#projects.values()].filter(
        (project) => this.#demand(project).visible,
      ),
    );
  }

  // ── Reads ─────────────────────────────────────────────────────────────

  async snapshot(projectId: string): Promise<GitWorkspaceSnapshot> {
    this.#assertOpen();
    const project = this.#project(projectId);
    if (!project.loaded) {
      project.discovery.dirty = markDirty(
        project.discovery.dirty,
        this.#now(),
        true,
      );
      const wait = this.#waitDiscovery(project);
      this.#pump();
      await wait;
    }
    return projectView(
      project,
      this.demands.demands(project.projectId).length > 0,
    );
  }

  async detail(
    projectId: string,
    repo: string,
  ): Promise<GitRepoDetailSnapshot> {
    this.#assertOpen();
    const project = this.#project(projectId);
    const entry = this.#entry(project, repo);
    if (!entry.detail) {
      entry.forceDetail = true;
      this.#dirty(entry, true);
      const wait = this.#waitEntry(entry);
      this.#pump();
      await wait;
    }
    const detail = entry.detail;
    if (!detail) throw new Error("Repository detail is unavailable");
    const result = { ...detail, stale: !!entry.dirty || entry.running };
    // Without demand nothing keeps the detail fresh, so do not retain it.
    if (!wantsDetail(this.#demand(project), repo)) entry.detail = undefined;
    return result;
  }

  // ── Internals ─────────────────────────────────────────────────────────

  #assertOpen() {
    if (this.#closed) throw new Error("Git workspace sync is closed");
  }

  #project(projectId: string): ProjectEntry {
    let project = this.#projects.get(projectId);
    if (!project) {
      project = {
        projectId,
        revision: 0,
        loaded: false,
        projectIsRepo: false,
        discoveryErrors: [],
        outsideWorktrees: [],
        repos: new Map(),
        visible: false,
        discoveredKeys: new Set(),
        structureCheck: { running: false, nextAt: 0 },
        discovery: { running: false, waiters: [] },
      };
      this.#projects.set(projectId, project);
    }
    return project;
  }

  #entry(project: ProjectEntry, repo: string): RepoEntry {
    let entry = project.repos.get(repo);
    if (!entry) {
      entry = {
        repo,
        mutation: false,
        warmOnly: false,
        forceDetail: false,
        live: false,
        running: false,
        degraded: false,
        pollUncertain: false,
        lastReadAt: null,
        superseded: 0,
        waiters: [],
      };
      project.repos.set(repo, entry);
    }
    return entry;
  }

  #demand(project: ProjectEntry): ProjectDemandSummary {
    return summarizeDemands(this.demands.demands(project.projectId));
  }

  #dirty(entry: RepoEntry, immediate: boolean, warm = false) {
    entry.warmOnly = warm && (!entry.dirty || entry.warmOnly);
    entry.dirty = markDirty(entry.dirty, this.#now(), immediate);
  }

  /** Worktrees or repositories appeared or vanished: discover again (bypassing read caches). */
  #rediscover(project: ProjectEntry) {
    project.discovery.dirty = markDirty(
      project.discovery.dirty,
      this.#now(),
      true,
    );
  }

  #waitEntry(entry: RepoEntry, timeoutMs = READ_WAIT_MS) {
    return waitForRead(entry, timeoutMs);
  }

  #waitDiscovery(project: ProjectEntry) {
    return waitForRead(project.discovery, READ_WAIT_MS);
  }

  /** Recompute liveness after a demand change; schedule what newly needs reading. */
  #applyDemand(project: ProjectEntry) {
    const demand = this.#demand(project);
    const becameVisible = demand.visible && !project.visible;
    project.visible = demand.visible;
    if (becameVisible) {
      // The monitor was not watching: everything may have moved.
      project.discovery.dirty = markDirty(
        project.discovery.dirty,
        this.#now(),
        true,
      );
    }
    const wanted = new Set([...demand.details, ...demand.hints]);
    for (const repo of wanted) this.#entry(project, repo);
    for (const entry of project.repos.values()) {
      const live = demand.visible || wanted.has(entry.repo);
      const wasLive = entry.live;
      entry.live = live;
      if (!live) {
        entry.degraded = false;
        entry.pollUncertain = false;
      }
      const detailWanted = wantsDetail(demand, entry.repo);
      if (!detailWanted) entry.detail = undefined;
      if (live && !wasLive && !becameVisible) this.#dirty(entry, true);
      else if (detailWanted && !entry.detail)
        this.#dirty(entry, true, !demand.details.has(entry.repo));
    }
    const [selected] = demand.details;
    if (selected) project.selected = selected;
    this.#pump();
  }

  /** Plan and start reads; (re)arm the wake-up timer. Synchronous and idempotent. */
  #pump() {
    if (this.#closed) return;
    const now = this.#now();
    const candidates: QueueCandidate[] = [];
    const meta = new Map<
      string,
      { project: ProjectEntry; entry?: RepoEntry }
    >();
    let pollWake: number | null = null;
    for (const project of this.#projects.values()) {
      const demand = this.#demand(project);
      const discovery = project.discovery;
      if (discovery.dirty && !discovery.running) {
        if (demand.visible || discovery.dirty.immediate) {
          const key = `d\0${project.projectId}`;
          candidates.push({
            key,
            priority: discovery.dirty.immediate ? "detail" : "selected",
            dirty: discovery.dirty,
            running: false,
          });
          meta.set(key, { project });
        }
      }
      const check = project.structureCheck;
      if (
        demand.visible &&
        project.loaded &&
        this.backend.listRepositoryPaths &&
        !check.running
      ) {
        if (check.nextAt <= now) this.#checkStructure(project);
        else pollWake = Math.min(pollWake ?? check.nextAt, check.nextAt);
      }
      for (const entry of project.repos.values()) {
        if (
          entry.live &&
          !entry.dirty &&
          !entry.running &&
          (entry.degraded || entry.pollUncertain)
        ) {
          const at = nextUncertainPoll(entry.lastReadAt, now);
          if (at <= now) this.#dirty(entry, false);
          else pollWake = Math.min(pollWake ?? at, at);
        }
        if (!entry.dirty || entry.running) continue;
        const priority =
          repoPriority(
            demand,
            entry.repo,
            project.selected,
            entry.mutation,
            entry.warmOnly,
          ) ?? (entry.dirty.immediate ? "detail" : null);
        if (!priority) continue;
        const key = `r\0${project.projectId}\0${entry.repo}`;
        candidates.push({
          key,
          priority,
          dirty: entry.dirty,
          running: false,
        });
        meta.set(key, { project, entry });
      }
    }
    const plan = planReads(
      candidates,
      now,
      this.#running.size,
      this.options.concurrency,
    );
    for (const key of plan.start) {
      const target = meta.get(key);
      if (!target) continue;
      const run = target.entry
        ? this.#readRepo(target.project, target.entry)
        : this.#readDiscovery(target.project);
      const tracked: Promise<void> = run.finally(() => {
        this.#running.delete(tracked);
        this.#pump();
      });
      this.#running.add(tracked);
    }
    clearTimeout(this.#timer);
    this.#timer = undefined;
    const wake = [plan.wakeAt, pollWake].filter(
      (value): value is number => value !== null,
    );
    if (wake.length) {
      this.#timer = setTimeout(
        () => this.#pump(),
        Math.max(0, Math.min(...wake) - now),
      );
      this.#timer.unref();
    }
  }

  /**
   * Cheap periodic check (no status reads) that covers what monitor notices
   * cannot: repositories and worktrees created or removed anywhere in the project.
   */
  #checkStructure(project: ProjectEntry) {
    const check = project.structureCheck;
    check.running = true;
    const run = (async () => {
      try {
        const paths = await this.backend.listRepositoryPaths?.(
          project.projectId,
        );
        if (!paths) return;
        const same =
          paths.length === project.discoveredKeys.size &&
          paths.every((path) => project.discoveredKeys.has(path));
        if (!same) this.#rediscover(project);
      } catch {
        /* The next check retries. */
      } finally {
        check.running = false;
        check.nextAt = this.#now() + GIT_WORKSPACE_STRUCTURE_CHECK_MS;
      }
    })();
    const tracked: Promise<void> = run.finally(() => {
      this.#running.delete(tracked);
      this.#pump();
    });
    this.#running.add(tracked);
  }

  async #readRepo(project: ProjectEntry, entry: RepoEntry): Promise<void> {
    const waiters = entry.waiters.splice(0);
    const forceDetail = entry.forceDetail;
    const needDetail =
      wantsDetail(this.#demand(project), entry.repo) || forceDetail;
    entry.dirty = undefined;
    entry.mutation = false;
    entry.warmOnly = false;
    entry.forceDetail = false;
    entry.running = true;
    try {
      // Summary tier reads no file list; only demanded detail pays for the overview.
      const overview = needDetail
        ? await this.backend.overview(project.projectId, entry.repo)
        : undefined;
      const signature = overview
        ? await (this.options.fileSignature ?? statSignature)(
            this.backend.resolveRepoDir(project.projectId, entry.repo),
            overview.files.map((file) => file.path),
          )
        : undefined;
      const summary =
        overview?.repo ??
        (await this.backend.repoSummary(project.projectId, entry.repo));
      entry.lastReadAt = this.#now();
      entry.running = false;
      entry.superseded = 0;
      const changes = this.#applyOverview(
        project,
        entry,
        summary,
        overview,
        signature,
      );
      if (overview?.stale) this.#dirty(entry, false);
      this.#emit(project, changes);
      for (const waiter of waiters) waiter.resolve();
    } catch (error) {
      entry.running = false;
      if (isSuperseded(error) && ++entry.superseded < MAX_SUPERSEDED_READS) {
        // A newer invalidation aborted the read: read again once.
        entry.forceDetail ||= forceDetail;
        this.#dirty(entry, false);
        entry.waiters.unshift(...waiters);
      } else {
        entry.superseded = 0;
        const before = fingerprint(projectErrors(project));
        entry.failed = {
          repo: entry.repo,
          category: errorCategory(error),
          message: "Repository could not be read.",
          retryable: true,
        };
        entry.lastReadAt = this.#now();
        if (before !== fingerprint(projectErrors(project)))
          this.#emit(project, { repos: [entry.repo], detail: [] });
        for (const waiter of waiters) waiter.reject(error);
      }
    }
  }

  #applyOverview(
    project: ProjectEntry,
    entry: RepoEntry,
    summary: GitRepoSummary,
    overview: GitOverviewResponse | undefined,
    signature?: string,
  ): { repos: string[]; detail: string[] } {
    const repos: string[] = [];
    const detail: string[] = [];
    const hadFailure = entry.failed !== undefined;
    entry.failed = undefined;
    if (this.#setSummary(project, entry, summary) || hadFailure)
      repos.push(entry.repo);
    if (overview && applyDetail(project, entry, overview, signature))
      detail.push(entry.repo);
    return { repos, detail };
  }

  /** Returns true when the summary content changed. */
  #setSummary(
    project: ProjectEntry,
    entry: RepoEntry,
    summary: GitRepoSummary,
  ): boolean {
    const fp = fingerprint(summary);
    if (fp === entry.summaryFp) return false;
    const previous = entry.summary;
    entry.summary = summary;
    entry.summaryFp = fp;
    if (
      !previous ||
      previous.currentBranch !== summary.currentBranch ||
      previous.detached !== summary.detached
    ) {
      try {
        this.options.onBranchChanged?.({
          projectId: project.projectId,
          repo: entry.repo,
          branch: summary.currentBranch,
          detached: summary.detached,
          previous: previous ? previous.currentBranch : undefined,
        });
      } catch {
        /* Observers cannot fail a read. */
      }
    }
    return true;
  }

  async #readDiscovery(project: ProjectEntry): Promise<void> {
    const discovery = project.discovery;
    const startedAt = this.#now();
    const waiters = discovery.waiters.splice(0);
    const refresh = discovery.dirty?.immediate === true && project.loaded;
    discovery.dirty = undefined;
    discovery.running = true;
    try {
      const result = await this.backend.discoverRepos(
        project.projectId,
        refresh,
      );
      discovery.running = false;
      const demand = this.#demand(project);
      const repos: string[] = [];
      const detail: string[] = [];
      const seen = new Set<string>();
      for (const summary of result.repos) {
        seen.add(summary.relativePath);
        const entry = this.#entry(project, summary.relativePath);
        entry.live ||= demand.visible;
        entry.lastReadAt = this.#now();
        entry.failed = undefined;
        if (this.#setSummary(project, entry, summary)) repos.push(entry.repo);
        // Discovery just read this repository: earlier changes are included.
        if (
          entry.dirty &&
          entry.dirty.lastAt <= startedAt &&
          !(wantsDetail(demand, entry.repo) && !entry.detail)
        )
          entry.dirty = undefined;
      }
      const errored = new Set((result.errors ?? []).map((e) => e.repo));
      for (const [repo, entry] of [...project.repos])
        if (!seen.has(repo) && !errored.has(repo) && entry.summary) {
          if (wantsDetail(demand, repo)) {
            // Keep a demanded repository; its own read reports the failure.
            this.#dirty(entry, false);
            continue;
          }
          project.repos.delete(repo);
          repos.push(repo);
        }
      project.discoveredKeys = new Set([...seen, ...errored]);
      project.structureCheck.nextAt =
        this.#now() + GIT_WORKSPACE_STRUCTURE_CHECK_MS;
      const errors = (result.errors ?? []).map((error) => ({ ...error }));
      const errorsChanged =
        fingerprint(errors) !== fingerprint(project.discoveryErrors);
      project.discoveryErrors = errors;
      const outside = (result.outsideWorktrees ?? []).map((entry) => ({
        ...entry,
      }));
      const outsideChanged =
        fingerprint(outside) !== fingerprint(project.outsideWorktrees);
      project.outsideWorktrees = outside;
      const wasLoaded = project.loaded;
      const projectIsRepo = result.projectIsRepo;
      const structural =
        !wasLoaded ||
        projectIsRepo !== project.projectIsRepo ||
        errorsChanged ||
        outsideChanged;
      project.loaded = true;
      project.projectIsRepo = projectIsRepo;
      if (result.stale)
        project.discovery.dirty = markDirty(undefined, this.#now(), false);
      this.#emit(project, { repos, detail }, structural);
      for (const waiter of waiters) waiter.resolve();
      // Newly discovered repositories need monitor demand.
      void this.#monitorDemand.sync(project).catch(() => {});
    } catch (error) {
      discovery.running = false;
      if (isSuperseded(error)) {
        discovery.dirty = markDirty(discovery.dirty, this.#now(), false);
        discovery.waiters.unshift(...waiters);
      } else {
        for (const waiter of waiters) waiter.reject(error);
      }
    }
  }

  /** Bump the revision once and ping when anything changed. */
  #emit(
    project: ProjectEntry,
    changes: { repos: string[]; detail: string[] },
    structural = false,
  ) {
    if (!changes.repos.length && !changes.detail.length && !structural) return;
    project.revision += 1;
    for (const repo of changes.detail) {
      const entry = project.repos.get(repo);
      if (!entry) continue;
      entry.detailRevision = project.revision;
      if (entry.detail)
        entry.detail = { ...entry.detail, revision: project.revision };
    }
    if (this.#closed) return;
    try {
      void Promise.resolve(
        this.events.publish("git.workspace.changed", {
          projectId: project.projectId,
          revision: project.revision,
          repos: changes.repos.slice(0, 512),
          detail: changes.detail.slice(0, 512),
        }),
      ).catch(() => {});
    } catch {
      /* Publication cannot fail a read. */
    }
  }

  /** Test and shutdown helper: resolves when no read is running. */
  async idle() {
    while (this.#running.size) await Promise.allSettled([...this.#running]);
  }

  async close() {
    this.#closed = true;
    clearTimeout(this.#timer);
    this.#timer = undefined;
    const closed = new Error("Git workspace sync is closed");
    for (const project of this.#projects.values()) {
      for (const waiter of project.discovery.waiters.splice(0))
        waiter.reject(closed);
      for (const entry of project.repos.values())
        for (const waiter of entry.waiters.splice(0)) waiter.reject(closed);
    }
    await this.idle();
    this.#projects.clear();
    this.demands.owners.clear();
  }
}
