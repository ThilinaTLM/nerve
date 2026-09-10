import { SvelteMap, SvelteSet } from "svelte/reactivity";
import type { ProjectRecord } from "@nervekit/contracts/projects";
import type { GithubPrListFilters } from "@nervekit/contracts/git";
import {
  discoverGitRepos,
  getGithubStatus,
  getGitOverview,
  listGitBranches,
  listGithubPrHeads,
  listGithubPrs,
} from "../api/git.api";
import {
  gitProjectStateKey,
  gitRepoStateKey,
} from "$lib/domain/navigation/view-keys";
import { queryClient, queryKeys } from "$lib/platform/query/client";
import { hasPendingPrChecks } from "$lib/features/git/checks";
import { showCriticalError } from "$lib/application/notifications/critical-errors.svelte";
import { notify } from "$lib/application/notifications/notify.svelte";
import {
  GitAutoRefreshScheduler,
  type GitAutoRefreshDemand,
} from "./git-auto-refresh-scheduler";
import { joinGitProjectRefresh } from "./git-panel-refresh-policy";
import {
  applyGitContextFromProject,
  clearGithubState,
  ensureGitProjectState,
  ensureGitRepoState,
  errorMessage,
  filterMergedOpenPrs,
  type GitPanelProjectState,
  type GitPanelRefreshOptions,
  type GitPanelRepoState,
  gitPanelState,
  mergeRepoSummary,
  patchGitOverviewState,
  repoHasGithubRemote,
  repoMutationInProgress,
  saveSelectedRepo,
  setBranchesIfChanged,
  setGithubStatusIfChanged,
  setProjectRepos,
  setPrHeadsIfChanged,
  setPrsIfChanged,
  storedRepo,
} from "./git-panel-state.svelte";
import { syncOpenPrViews } from "./pr-tabs.svelte";
import {
  GITHUB_STATUS_STALE_MS,
  GIT_OVERVIEW_AUTO_REFRESH_COOLDOWN_MS,
  GIT_PR_AUTO_REFRESH_COOLDOWN_MS,
  GIT_STALE_MS,
  githubPrFiltersFingerprint,
  isFresh,
  PR_PENDING_POLL_MS,
  PR_STALE_MS,
} from "./git-refresh-policy";

function automaticRefreshKey(projectId: string, repo: string): string {
  return JSON.stringify([projectId, repo]);
}

const visibleOverviewDemand = new SvelteSet<string>();

const automaticRefreshScheduler = new GitAutoRefreshScheduler(
  {
    overview: GIT_OVERVIEW_AUTO_REFRESH_COOLDOWN_MS,
    prs: GIT_PR_AUTO_REFRESH_COOLDOWN_MS,
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
            refreshGitOverview(projectId, repo, {
              force: true,
              silent: true,
              onlyIfChanged: true,
            }),
          ]
        : []),
      ...(demand.prs && state.github?.authenticated
        ? [refreshPrs(projectId, repo, true, true)]
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
}

export function invalidateGitOverviewFromFilesystem(
  projectId: string,
  repo: string,
): void {
  const state =
    gitPanelState.projects[gitProjectStateKey(projectId)]?.repoStates[
      gitRepoStateKey(repo)
    ];
  if (!state) return;
  state.overviewInvalidated = true;
  if (
    visibleOverviewDemand.has(automaticRefreshKey(projectId, repo)) &&
    (typeof document === "undefined" || document.visibilityState === "visible")
  )
    scheduleAutomaticGitRefresh(projectId, repo, { overview: true });
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
  project: ProjectRecord,
  options: GitPanelRefreshOptions = {},
): Promise<void> {
  const state = ensureGitProjectState(project);
  const loadDetails = options.loadDetails !== false;
  if (joinGitProjectRefresh(state, loadDetails)) {
    if (options.force) {
      state.discoveryRequest.refreshQueued = true;
      state.discoveryRequest.queuedLoadsDetails ||= loadDetails;
    }
    return;
  }
  const requestSeq = state.discoveryRequest.sequence + 1;
  state.discoveryRequest.sequence = requestSeq;
  state.discoveryRequest.inFlight = true;
  state.discoveryRequest.loadsDetails = loadDetails;
  state.discoverError = undefined;
  const showFullLoading = !state.loaded && !options.silent;
  state.loadingRepos = showFullLoading;
  state.refreshingRepos = !showFullLoading && !options.silent;
  try {
    if (options.force)
      await queryClient.invalidateQueries({
        queryKey: queryKeys.git.repos(project.id),
      });
    const result = await queryClient.fetchQuery({
      queryKey: queryKeys.git.repos(project.id),
      queryFn: () => discoverGitRepos(project.id),
      staleTime: GIT_STALE_MS,
    });
    if (state.discoveryRequest.sequence !== requestSeq) return;

    if (state.projectIsRepo !== result.projectIsRepo) {
      state.projectIsRepo = result.projectIsRepo;
    }
    setProjectRepos(state, result.repos);
    for (const repo of result.repos)
      ensureGitRepoState(project.id, repo.relativePath);

    const stored = storedRepo(project.id);
    const currentExists = result.repos.some(
      (repo) => repo.relativePath === state.selectedRepo,
    );
    const fallback = result.repos[0]?.relativePath ?? ".";
    let nextSelectedRepo = state.selectedRepo;
    if (stored && result.repos.some((repo) => repo.relativePath === stored)) {
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
    state.loadedAt = Date.now();
    applyGitContextFromProject(project.id);

    if (result.repos.length > 0 && state.discoveryRequest.loadsDetails) {
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
        refreshPrs(
          project.id,
          state.selectedRepo,
          !options.criticalErrorTitle,
          false,
          true,
          options.criticalErrorTitle,
        ),
      ]);
    }
  } catch (error) {
    if (state.discoveryRequest.sequence !== requestSeq) return;
    state.discoverError = errorMessage(error);
    if (options.criticalErrorTitle)
      showCriticalError(options.criticalErrorTitle, state.discoverError);
    if (!state.loaded) setProjectRepos(state, []);
  } finally {
    if (state.discoveryRequest.sequence === requestSeq) {
      state.loadingRepos = false;
      state.refreshingRepos = false;
      state.discoveryRequest.inFlight = false;
      state.discoveryRequest.loadsDetails = false;
      if (state.discoveryRequest.refreshQueued) {
        const loadDetails = state.discoveryRequest.queuedLoadsDetails;
        state.discoveryRequest.refreshQueued = false;
        state.discoveryRequest.queuedLoadsDetails = false;
        queueMicrotask(
          () =>
            void refreshGitProject(project, {
              force: false,
              silent: true,
              onlyIfChanged: true,
              loadDetails,
            }),
        );
      }
    }
  }
}

export async function refreshGitOverview(
  projectId: string,
  repo: string,
  options: GitPanelRefreshOptions = {},
): Promise<void> {
  const state = ensureGitRepoState(projectId, repo);
  if (state.overviewRequest.inFlight) {
    if (options.force) state.overviewRequest.refreshQueued = true;
    return;
  }
  automaticRefreshScheduler.noteDirectStart(
    automaticRefreshKey(projectId, repo),
    { overview: true },
  );
  const requestSeq = state.overviewRequest.sequence + 1;
  state.overviewRequest.sequence = requestSeq;
  state.overviewRequest.inFlight = true;
  if (!options.silent) state.loadingOverview = true;
  state.overviewInvalidated = false;
  try {
    if (options.force)
      await queryClient.invalidateQueries({
        queryKey: queryKeys.git.overview(projectId, repo),
      });
    const next = await queryClient.fetchQuery({
      queryKey: queryKeys.git.overview(projectId, repo),
      queryFn: () => getGitOverview(projectId, repo),
      staleTime: GIT_STALE_MS,
    });
    if (state.overviewRequest.sequence !== requestSeq) return;
    mergeRepoSummary(projectId, next.repo);
    patchGitOverviewState(state, next);
  } catch (error) {
    state.overviewInvalidated = true;
    const details = errorMessage(error);
    if (options.criticalErrorTitle)
      showCriticalError(options.criticalErrorTitle, details);
    else if (!options.silent) notify.error(`Git overview failed: ${details}`);
  } finally {
    if (state.overviewRequest.sequence === requestSeq) {
      if (!options.silent) state.loadingOverview = false;
      state.overviewRequest.inFlight = false;
      if (state.overviewRequest.refreshQueued) {
        state.overviewRequest.refreshQueued = false;
        queueMicrotask(
          () =>
            void refreshGitOverview(projectId, repo, {
              silent: true,
              force: true,
              onlyIfChanged: true,
            }),
        );
      }
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

export async function refreshPrHeads(
  projectId: string,
  repo: string,
  force = false,
): Promise<void> {
  const state = ensureGitRepoState(projectId, repo);
  if (!repoHasGithubRemote(projectId, repo) || !state.github?.authenticated) {
    setPrHeadsIfChanged(state, undefined);
    return;
  }
  state.loadingPrHeads = true;
  try {
    const queryKey = queryKeys.git.prHeads(projectId, repo);
    if (force) await queryClient.invalidateQueries({ queryKey });
    const result = await queryClient.fetchQuery({
      queryKey,
      queryFn: () => listGithubPrHeads(projectId, repo),
      staleTime: GIT_STALE_MS,
    });
    setPrHeadsIfChanged(state, result);
  } catch {
    // Pull request badges are optional enrichment and must not block branches.
    setPrHeadsIfChanged(state, undefined);
  } finally {
    state.loadingPrHeads = false;
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
    if (status.authenticated) {
      await refreshPrs(
        projectId,
        repo,
        !criticalErrorTitle,
        force,
        Boolean(criticalErrorTitle),
        criticalErrorTitle,
      );
    } else {
      setPrsIfChanged(state, []);
      if (criticalErrorTitle)
        showCriticalError(
          criticalErrorTitle,
          status.reason ?? "GitHub authentication is required.",
        );
    }
  } catch (error) {
    setGithubStatusIfChanged(state, {
      available: false,
      authenticated: false,
      login: null,
      reason: errorMessage(error),
    });
    setPrsIfChanged(state, []);
    applyGitContextFromProject(projectId);
    if (criticalErrorTitle)
      showCriticalError(criticalErrorTitle, errorMessage(error));
  }
}

const prRefreshRequests = new SvelteMap<string, Promise<void>>();

function currentPrFilters(state: GitPanelRepoState): GithubPrListFilters {
  return {
    author: state.prFilters.author,
    ...(state.prFilters.author === "username"
      ? { username: state.prFilters.username }
      : {}),
    drafts: state.prFilters.drafts,
    title: state.prFilters.title,
    ...(state.prFilters.currentBranchOnly && state.repoSummary?.currentBranch
      ? { head: state.repoSummary.currentBranch }
      : {}),
    labels: [...state.prFilters.labels],
    sort: state.prFilters.sort,
  };
}

export async function refreshPrs(
  projectId: string,
  repo: string,
  silent = false,
  force = false,
  showLoading = !silent,
  criticalErrorTitle?: string,
): Promise<void> {
  const state = ensureGitRepoState(projectId, repo);
  if (!repoHasGithubRemote(projectId, repo)) {
    clearGithubState(projectId, state);
    return;
  }
  const refreshKey = automaticRefreshKey(projectId, repo);
  const existing = prRefreshRequests.get(refreshKey);
  if (existing) {
    state.prsRequest.refreshQueued ||= force;
    state.prsRequest.queuedVisible ||= showLoading;
    if (showLoading) {
      state.loadingPrs = true;
      state.prsError = undefined;
    }
    return existing;
  }

  if (showLoading) {
    state.loadingPrs = true;
    state.prsError = undefined;
  }
  state.prsRequest.inFlight = true;
  automaticRefreshScheduler.noteDirectStart(refreshKey, { prs: true });

  const request = (async () => {
    let nextSilent = silent;
    let nextForce = force;
    try {
      do {
        state.prsRequest.refreshQueued = false;
        state.prsRequest.queuedVisible = false;
        const requestSeq = state.prsRequest.sequence + 1;
        state.prsRequest.sequence = requestSeq;
        try {
          const filters = currentPrFilters(state);
          const queryKey = queryKeys.git.prs(
            projectId,
            repo,
            githubPrFiltersFingerprint(filters),
          );
          if (nextForce) await queryClient.invalidateQueries({ queryKey });
          const result = await queryClient.fetchQuery({
            queryKey,
            queryFn: () => listGithubPrs(projectId, repo, filters),
            staleTime: hasPendingPrChecks(state.prs)
              ? PR_PENDING_POLL_MS
              : GIT_STALE_MS,
          });
          if (
            state.prsRequest.sequence === requestSeq &&
            githubPrFiltersFingerprint(filters) ===
              githubPrFiltersFingerprint(currentPrFilters(state))
          ) {
            const prs = filterMergedOpenPrs(projectId, repo, result.prs);
            setPrsIfChanged(state, prs);
            syncOpenPrViews(projectId, repo, prs);
            state.prsError = undefined;
            state.prsLoadedAt = Date.now();
          }
        } catch (error) {
          if (state.prsRequest.sequence === requestSeq) {
            const details = errorMessage(error);
            if (!nextSilent) state.prsError = details;
            if (criticalErrorTitle)
              showCriticalError(criticalErrorTitle, details);
            else if (!nextSilent)
              notify.error(`Could not list PRs: ${details}`);
          }
        }
        nextForce = state.prsRequest.refreshQueued;
        nextSilent = !state.prsRequest.queuedVisible;
      } while (
        state.prsRequest.refreshQueued &&
        (typeof document === "undefined" ||
          document.visibilityState === "visible")
      );
    } finally {
      state.prsRequest.inFlight = false;
      state.prsRequest.refreshQueued = false;
      state.prsRequest.queuedVisible = false;
      state.loadingPrs = false;
    }
  })();
  prRefreshRequests.set(refreshKey, request);
  try {
    await request;
  } finally {
    if (prRefreshRequests.get(refreshKey) === request)
      prRefreshRequests.delete(refreshKey);
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
    scheduleAutomaticGitRefresh(projectId, repo, { overview: true });
    return;
  }
  if (!state || isFresh(state.loadedAt, Date.now(), GIT_STALE_MS)) return;
  scheduleAutomaticGitRefresh(projectId, repo, { overview: true });
}

export function autoRefreshPrsIfStale(projectId: string, repo: string): void {
  if (typeof document !== "undefined" && document.visibilityState !== "visible")
    return;
  const state =
    gitPanelState.projects[gitProjectStateKey(projectId)]?.repoStates[
      gitRepoStateKey(repo)
    ];
  if (
    !state?.github?.authenticated ||
    isFresh(state.prsLoadedAt, Date.now(), PR_STALE_MS)
  )
    return;
  scheduleAutomaticGitRefresh(projectId, repo, { prs: true });
}

export function selectGitProject(project: ProjectRecord): void {
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
    if (state.github?.authenticated) void refreshPrs(projectId, repo, true);
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
            dir: project.projectDir,
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
