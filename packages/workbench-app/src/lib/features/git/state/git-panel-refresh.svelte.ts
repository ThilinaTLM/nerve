import { SvelteSet } from "svelte/reactivity";
import type { Project } from "@nervekit/contracts/core";
import {
  discoverGitRepos,
  getGithubStatus,
  getGitOverview,
  listGitBranches,
  syncGitRepositoryMonitor,
} from "../api/git.api";
import {
  gitProjectStateKey,
  gitRepoStateKey,
} from "$lib/domain/navigation/view-keys";
import { queryClient, queryKeys } from "$lib/platform/query/client";
import { selection } from "$lib/application/workspace/selection.svelte";
import { refreshGitRead } from "./git-read-refresh";
import { showCriticalError } from "$lib/application/notifications/critical-errors.svelte";
import { notify } from "$lib/application/notifications/notify.svelte";
import {
  GitAutoRefreshScheduler,
  type GitAutoRefreshDemand,
} from "./git-auto-refresh-scheduler";
import {
  joinGitProjectRefresh,
  joinGitReadRefresh,
  gitAutomaticOverviewOptions,
  gitOverviewReadInvalidation,
  createGitOverviewReadGuard,
  consumeGitReadSoftDemand,
  takeGitReadQueuedRefresh,
  type GitPanelRefreshOptions,
} from "./git-panel-refresh-policy";
import {
  applyGitContextFromProject,
  clearGithubState,
  ensureGitProjectState,
  ensureGitRepoState,
  errorMessage,
  type GitPanelProjectState,
  gitPanelState,
  mergeRepoSummary,
  patchGitOverviewState,
  repoHasGithubRemote,
  repoMutationInProgress,
  saveSelectedRepo,
  setBranchesIfChanged,
  setGithubStatusIfChanged,
  setProjectRepos,
  storedRepo,
} from "./git-panel-state.svelte";
import {
  GITHUB_STATUS_STALE_MS,
  GIT_OVERVIEW_AUTO_REFRESH_COOLDOWN_MS,
  GIT_STALE_MS,
  isFresh,
} from "./git-refresh-policy";

function automaticRefreshKey(projectId: string, repo: string): string {
  return JSON.stringify([projectId, repo]);
}

const visibleOverviewDemand = new SvelteSet<string>();

function hasGitReadDemand(
  projectId: string,
  silent: boolean | undefined,
  repo?: string,
): boolean {
  if (selection.projectId !== projectId) return false;
  if (!silent) return true;
  return repo !== undefined
    ? visibleOverviewDemand.has(automaticRefreshKey(projectId, repo))
    : [...visibleOverviewDemand].some(
        (key) => (JSON.parse(key) as [string, string])[0] === projectId,
      );
}

const automaticRefreshScheduler = new GitAutoRefreshScheduler(
  {
    overview: GIT_OVERVIEW_AUTO_REFRESH_COOLDOWN_MS,
  },
  (key, demand) => {
    const [projectId, repo] = JSON.parse(key) as [string, string];
    const state = ensureGitRepoState(projectId, repo);
    if (repoMutationInProgress(state)) {
      automaticRefreshScheduler.schedule(key, demand);
      return;
    }
    void Promise.all([
      ...(demand.overview
        ? [
            refreshGitOverview(
              projectId,
              repo,
              gitAutomaticOverviewOptions(demand),
            ),
          ]
        : []),
    ]);
  },
);

export function setGitOverviewRefreshVisible(
  projectId: string,
  repo: string,
  visible: boolean,
): void {
  const key = automaticRefreshKey(projectId, repo);
  if (visible) visibleOverviewDemand.add(key);
  else visibleOverviewDemand.delete(key);
  void syncGitRepositoryMonitor(projectId, repo, visible).catch(
    () => undefined,
  );
}

export function invalidateGitOverviewFromFilesystem(
  projectId: string,
  repo: string,
  uncertain = false,
): void {
  const state =
    gitPanelState.projects[gitProjectStateKey(projectId)]?.repoStates[
      gitRepoStateKey(repo)
    ];
  if (!state) return;
  state.overviewRequest.uncertainInvalidation = state.overviewInvalidated
    ? Boolean(state.overviewRequest.uncertainInvalidation && uncertain)
    : uncertain;
  state.overviewInvalidated = true;
  state.overviewRequest.invalidation =
    (state.overviewRequest.invalidation ?? 0) + 1;
  if (
    visibleOverviewDemand.has(automaticRefreshKey(projectId, repo)) &&
    (typeof document === "undefined" || document.visibilityState === "visible")
  )
    scheduleAutomaticGitRefresh(projectId, repo, {
      overview: true,
      ...(state.overviewRequest.uncertainInvalidation
        ? { uncertain: true }
        : {}),
    });
}

export function scheduleAutomaticGitRefresh(
  projectId: string,
  repo: string,
  demand: GitAutoRefreshDemand,
): void {
  automaticRefreshScheduler.schedule(
    automaticRefreshKey(projectId, repo),
    demand,
  );
}

export function scheduleAutomaticProjectGitRefresh(
  projectId: string | undefined,
  demand: GitAutoRefreshDemand,
): void {
  if (!projectId) return;
  const project = gitPanelState.projects[gitProjectStateKey(projectId)];
  if (!project?.selectedRepo) return;
  scheduleAutomaticGitRefresh(projectId, project.selectedRepo, demand);
}

export async function refreshGitProject(
  project: Project,
  options: GitPanelRefreshOptions = {},
): Promise<void> {
  const state = ensureGitProjectState(project);
  const loadDetails = options.loadDetails !== false;
  if (joinGitProjectRefresh(state, loadDetails, options)) {
    if (state.discoveryRequest.refreshQueued)
      state.discoveryRequest.queuedLoadsDetails ||= loadDetails;
    return;
  }
  const requestSeq = state.discoveryRequest.sequence + 1;
  state.discoveryRequest.sequence = requestSeq;
  const isCurrent = () =>
    state.discoveryRequest.sequence === requestSeq &&
    gitPanelState.projects[gitProjectStateKey(project.id)] === state;
  state.discoveryRequest.inFlight = true;
  state.discoveryRequest.loadsDetails = loadDetails;
  state.discoverError = undefined;
  const showFullLoading = !state.loaded && !options.silent;
  state.loadingRepos = showFullLoading;
  state.refreshingRepos = !showFullLoading && !options.silent;
  let followedUp = false;
  try {
    const result = await refreshGitRead({
      client: queryClient,
      queryKey: queryKeys.git.repos(project.id),
      staleTime: GIT_STALE_MS,
      invalidate: options.force
        ? "hard"
        : options.uncertain
          ? "soft"
          : undefined,
      read: (followup) =>
        discoverGitRepos(project.id, followup ? false : options.force),
      isCurrent,
      hasDemand: () =>
        selection.projectId === project.id &&
        (state.discoveryRequest.loadsDetails ||
          hasGitReadDemand(project.id, options.silent)),
      canFollowup: () => consumeGitReadSoftDemand(state.discoveryRequest),
      onFollowup: () => {
        followedUp = true;
      },
      publish: (result) => {
        if (state.projectIsRepo !== result.projectIsRepo) {
          state.projectIsRepo = result.projectIsRepo;
        }
        state.readErrors = result.errors ?? [];
        state.readsStale = result.stale ?? false;
        setProjectRepos(state, result.repos);
        for (const repo of result.repos)
          ensureGitRepoState(project.id, repo.relativePath);

        const stored = storedRepo(project.id);
        const currentExists = result.repos.some(
          (repo) => repo.relativePath === state.selectedRepo,
        );
        const fallback = result.repos[0]?.relativePath ?? ".";
        let nextSelectedRepo = state.selectedRepo;
        if (
          stored &&
          result.repos.some((repo) => repo.relativePath === stored)
        ) {
          nextSelectedRepo = stored;
        } else if (!currentExists) {
          nextSelectedRepo = fallback;
        }
        if (state.selectedRepo !== nextSelectedRepo) {
          state.selectedRepo = nextSelectedRepo;
        }

        if (!state.loaded) {
          state.loaded = true;
        }
        state.loadedAt = result.stale ? undefined : Date.now();
        applyGitContextFromProject(project.id);
      },
    });
    if (!result) return;

    if (
      result.repos.length > 0 &&
      state.discoveryRequest.loadsDetails &&
      selection.projectId === project.id
    ) {
      const repoState = ensureGitRepoState(project.id, state.selectedRepo);
      const refreshOptions = repoState.loaded
        ? { silent: true, onlyIfChanged: true }
        : {};
      await Promise.all([
        refreshGitOverview(project.id, state.selectedRepo, {
          ...refreshOptions,
          criticalErrorTitle: options.criticalErrorTitle,
        }),
        refreshGithub(
          project.id,
          state.selectedRepo,
          false,
          options.criticalErrorTitle,
        ),
      ]);
    }
  } catch (error) {
    if (!isCurrent()) return;
    state.discoverError = errorMessage(error);
    if (options.criticalErrorTitle)
      showCriticalError(options.criticalErrorTitle, state.discoverError);
    if (!state.loaded) setProjectRepos(state, []);
  } finally {
    if (isCurrent()) {
      state.loadingRepos = false;
      state.refreshingRepos = false;
      state.discoveryRequest.inFlight = false;
      state.discoveryRequest.loadsDetails = false;
      const loadDetails = state.discoveryRequest.queuedLoadsDetails;
      state.discoveryRequest.queuedLoadsDetails = false;
      const queued = takeGitReadQueuedRefresh(
        state.discoveryRequest,
        followedUp,
        hasGitReadDemand(project.id, options.silent),
      );
      if (queued)
        queueMicrotask(
          () => void refreshGitProject(project, { ...queued, loadDetails }),
        );
    }
  }
}

export async function refreshGitOverview(
  projectId: string,
  repo: string,
  options: GitPanelRefreshOptions = {},
): Promise<void> {
  const state = ensureGitRepoState(projectId, repo);
  if (joinGitReadRefresh(state.overviewRequest, options)) return;
  automaticRefreshScheduler.noteDirectStart(
    automaticRefreshKey(projectId, repo),
    { overview: true },
  );
  const requestSeq = state.overviewRequest.sequence + 1;
  state.overviewRequest.sequence = requestSeq;
  state.overviewRequest.inFlight = true;
  if (!options.silent) state.loadingOverview = true;
  const freshness = createGitOverviewReadGuard(
    state.overviewRequest,
    state.overviewInvalidated,
  );
  let followedUp = false;
  const isCurrent = () =>
    state.overviewRequest.sequence === requestSeq &&
    gitPanelState.projects[gitProjectStateKey(projectId)]?.repoStates[
      gitRepoStateKey(repo)
    ] === state;
  try {
    await refreshGitRead({
      client: queryClient,
      queryKey: queryKeys.git.overview(projectId, repo),
      staleTime: GIT_STALE_MS,
      invalidate: gitOverviewReadInvalidation(
        options,
        state.overviewInvalidated,
      ),
      read: () => {
        freshness.begin();
        return getGitOverview(projectId, repo);
      },
      isCurrent,
      hasDemand: () => hasGitReadDemand(projectId, options.silent, repo),
      isStale: () => state.overviewInvalidated,
      canFollowup: () => consumeGitReadSoftDemand(state.overviewRequest),
      onFollowup: () => {
        followedUp = true;
        freshness.expectRead();
      },
      publish: (next) => {
        mergeRepoSummary(projectId, next.repo);
        patchGitOverviewState(state, next);
        state.overviewInvalidated = freshness.isStale(next);
        if (state.overviewInvalidated) state.loadedAt = undefined;
        else state.overviewRequest.uncertainInvalidation = undefined;
      },
    });
  } catch (error) {
    if (!isCurrent()) return;
    state.overviewInvalidated = true;
    const details = errorMessage(error);
    if (options.criticalErrorTitle)
      showCriticalError(options.criticalErrorTitle, details);
    else if (!options.silent) notify.error(`Git overview failed: ${details}`);
  } finally {
    if (isCurrent()) {
      if (!options.silent) state.loadingOverview = false;
      state.overviewRequest.inFlight = false;
      const queued = takeGitReadQueuedRefresh(
        state.overviewRequest,
        followedUp,
        hasGitReadDemand(projectId, options.silent, repo),
      );
      if (queued)
        queueMicrotask(() => void refreshGitOverview(projectId, repo, queued));
    }
  }
}

export async function refreshBranches(
  projectId: string,
  repo: string,
  criticalErrorTitle?: string,
  force = false,
): Promise<void> {
  const state = ensureGitRepoState(projectId, repo);
  state.loadingBranches = true;
  try {
    const queryKey = queryKeys.git.branches(projectId, repo);
    if (force) await queryClient.invalidateQueries({ queryKey });
    const result = await queryClient.fetchQuery({
      queryKey,
      queryFn: () => listGitBranches(projectId, repo),
      staleTime: GIT_STALE_MS,
    });
    setBranchesIfChanged(state, result.branches);
  } catch (error) {
    const details = errorMessage(error);
    if (criticalErrorTitle) showCriticalError(criticalErrorTitle, details);
    else notify.error(`Could not list branches: ${details}`);
  } finally {
    state.loadingBranches = false;
  }
}

export async function refreshGithub(
  projectId: string,
  repo: string,
  force = false,
  criticalErrorTitle?: string,
): Promise<void> {
  const state = ensureGitRepoState(projectId, repo);
  if (!repoHasGithubRemote(projectId, repo)) {
    clearGithubState(projectId, state);
    return;
  }

  try {
    const statusKey = queryKeys.git.githubStatus(projectId, repo);
    if (force) await queryClient.invalidateQueries({ queryKey: statusKey });
    const status = await queryClient.fetchQuery({
      queryKey: statusKey,
      queryFn: () => getGithubStatus(projectId, repo),
      staleTime: state.github?.authenticated
        ? GITHUB_STATUS_STALE_MS
        : GIT_STALE_MS,
    });
    setGithubStatusIfChanged(state, status);
    applyGitContextFromProject(projectId);
  } catch (error) {
    setGithubStatusIfChanged(state, {
      available: false,
      authenticated: false,
      login: null,
      reason: errorMessage(error),
    });
    applyGitContextFromProject(projectId);
    if (criticalErrorTitle)
      showCriticalError(criticalErrorTitle, errorMessage(error));
  }
}

export function autoRefreshGitOverview(projectId: string, repo: string): void {
  if (
    typeof document !== "undefined" &&
    document.visibilityState !== "visible"
  ) {
    return;
  }
  const state =
    gitPanelState.projects[gitProjectStateKey(projectId)]?.repoStates[
      gitRepoStateKey(repo)
    ];
  if (state?.overviewInvalidated) {
    scheduleAutomaticGitRefresh(projectId, repo, {
      overview: true,
      ...(state.overviewRequest.uncertainInvalidation
        ? { uncertain: true }
        : {}),
    });
    return;
  }
  if (!state || isFresh(state.loadedAt, Date.now(), GIT_STALE_MS)) return;
  scheduleAutomaticGitRefresh(projectId, repo, { overview: true });
}

export function selectGitProject(project: Project): void {
  const state = ensureGitProjectState(project);
  if (!state.loaded) {
    void refreshGitProject(project);
    return;
  }
  if (!state.discoveryRequest.inFlight) {
    void refreshGitProject(project, { silent: true, onlyIfChanged: true });
  }
}

export function selectGitRepo(projectId: string, repo: string): void {
  const project = gitPanelState.projects[gitProjectStateKey(projectId)];
  if (!project || repo === project.selectedRepo) return;
  project.selectedRepo = repo;
  saveSelectedRepo(projectId, repo);
  const state = ensureGitRepoState(projectId, repo);
  if (!state.loaded) {
    void refreshGitOverview(projectId, repo);
    void refreshGithub(projectId, repo);
  } else if (!repoMutationInProgress(state)) {
    void refreshGitOverview(projectId, repo, {
      silent: true,
      onlyIfChanged: true,
    });
  }
  applyGitContextFromProject(projectId);
}

export async function invalidateGitPanel(
  projectId?: string,
  repo?: string,
): Promise<void> {
  const projects = projectId
    ? [gitPanelState.projects[gitProjectStateKey(projectId)]].filter(
        (project): project is GitPanelProjectState => Boolean(project),
      )
    : Object.values(gitPanelState.projects);
  await Promise.all(
    projects.map(async (project) => {
      const id = project.projectId;
      if (repo) {
        await Promise.all([
          refreshGitOverview(id, repo, { force: true }),
          refreshGithub(id, repo),
        ]);
      } else {
        await refreshGitProject(
          {
            id,
            directory: project.projectDir,
            name: project.projectDir,
            createdAt: "",
            updatedAt: "",
          },
          { force: true, silent: project.loaded },
        );
      }
    }),
  );
}

export async function refreshWorkbenchGit(): Promise<void> {
  await Promise.all(
    [...visibleOverviewDemand].map(async (key) => {
      const [projectId, repo] = JSON.parse(key) as [string, string];
      await refreshGitOverview(projectId, repo, { force: true, silent: true });
    }),
  );
}
