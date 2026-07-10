import type { ProjectRecord } from "$lib/api";
import {
  discoverGitRepos,
  getGithubStatus,
  getGitOverview,
  listGitBranches,
  listGithubPrs,
} from "$lib/api";
import {
  gitProjectStateKey,
  gitRepoStateKey,
} from "$lib/core/state/state-keys";
import { notify } from "$lib/features/notifications/notify.svelte";
import {
  applyGitContextFromProject,
  clearGithubState,
  ensureGitProjectState,
  ensureGitRepoState,
  errorMessage,
  type GitPanelProjectState,
  type GitPanelRefreshOptions,
  gitPanelState,
  mergeRepoSummary,
  patchGitOverviewState,
  repoHasGithubRemote,
  repoMutationInProgress,
  saveSelectedRepo,
  setBranchesIfChanged,
  setGithubStatusIfChanged,
  setProjectRepos,
  setPrsIfChanged,
  storedRepo,
} from "./git-panel-state.svelte";

export async function refreshGitProject(
  project: ProjectRecord,
  options: GitPanelRefreshOptions = {},
): Promise<void> {
  const state = ensureGitProjectState(project);
  if (state.reposRequestInFlight && !options.force) return;
  const requestSeq = state.requestSeq + 1;
  state.requestSeq = requestSeq;
  state.reposRequestInFlight = true;
  state.discoverError = undefined;
  const showFullLoading = !state.loaded && !options.silent;
  state.loadingRepos = showFullLoading;
  state.refreshingRepos = !showFullLoading && !options.silent;
  try {
    const result = await discoverGitRepos(project.id);
    if (state.requestSeq !== requestSeq) return;

    let changed = false;
    if (state.projectIsRepo !== result.projectIsRepo) {
      state.projectIsRepo = result.projectIsRepo;
      changed = true;
    }
    changed = setProjectRepos(state, result.repos) || changed;
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
      changed = true;
    }

    if (!state.loaded) {
      state.loaded = true;
      changed = true;
    }
    if (changed || state.loadedAt === undefined) state.loadedAt = Date.now();
    applyGitContextFromProject(project.id);

    if (result.repos.length > 0) {
      const repoState = ensureGitRepoState(project.id, state.selectedRepo);
      const refreshOptions = repoState.loaded
        ? { silent: true, onlyIfChanged: true }
        : {};
      await Promise.all([
        refreshGitOverview(project.id, state.selectedRepo, refreshOptions),
        refreshGithub(project.id, state.selectedRepo),
      ]);
    }
  } catch (error) {
    if (state.requestSeq !== requestSeq) return;
    state.discoverError = errorMessage(error);
    if (!state.loaded) setProjectRepos(state, []);
  } finally {
    if (state.requestSeq === requestSeq) {
      state.loadingRepos = false;
      state.refreshingRepos = false;
      state.reposRequestInFlight = false;
    }
  }
}

export async function refreshGitOverview(
  projectId: string,
  repo: string,
  options: GitPanelRefreshOptions = {},
): Promise<void> {
  const state = ensureGitRepoState(projectId, repo);
  if (state.overviewRequestInFlight && !options.force) return;
  const requestSeq = state.requestSeq + 1;
  state.requestSeq = requestSeq;
  state.overviewRequestInFlight = true;
  if (!options.silent) state.loadingOverview = true;
  try {
    const next = await getGitOverview(projectId, repo);
    if (state.requestSeq !== requestSeq) return;
    mergeRepoSummary(projectId, next.repo);
    patchGitOverviewState(state, next);
  } catch (error) {
    if (!options.silent)
      notify.error(`Git overview failed: ${errorMessage(error)}`);
  } finally {
    if (state.requestSeq === requestSeq) {
      if (!options.silent) state.loadingOverview = false;
      state.overviewRequestInFlight = false;
    }
  }
}

export async function refreshBranches(
  projectId: string,
  repo: string,
): Promise<void> {
  const state = ensureGitRepoState(projectId, repo);
  state.loadingBranches = true;
  try {
    const result = await listGitBranches(projectId, repo);
    setBranchesIfChanged(state, result.branches);
  } catch (error) {
    notify.error(`Could not list branches: ${errorMessage(error)}`);
  } finally {
    state.loadingBranches = false;
  }
}

export async function refreshGithub(
  projectId: string,
  repo: string,
): Promise<void> {
  const state = ensureGitRepoState(projectId, repo);
  if (!repoHasGithubRemote(projectId, repo)) {
    clearGithubState(projectId, state);
    return;
  }

  try {
    const status = await getGithubStatus(projectId, repo);
    setGithubStatusIfChanged(state, status);
    applyGitContextFromProject(projectId);
    if (status.authenticated) {
      await refreshPrs(projectId, repo, true);
    } else {
      setPrsIfChanged(state, []);
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
  }
}

export async function refreshPrs(
  projectId: string,
  repo: string,
  silent = false,
): Promise<void> {
  const state = ensureGitRepoState(projectId, repo);
  if (!repoHasGithubRemote(projectId, repo)) {
    clearGithubState(projectId, state);
    return;
  }
  if (state.prsRequestInFlight) return;
  state.prsRequestInFlight = true;
  if (!silent) state.loadingPrs = true;
  try {
    const result = await listGithubPrs(projectId, repo);
    setPrsIfChanged(state, result.prs);
  } catch (error) {
    if (!silent) notify.error(`Could not list PRs: ${errorMessage(error)}`);
  } finally {
    if (!silent) state.loadingPrs = false;
    state.prsRequestInFlight = false;
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
  if (!state || state.overviewRequestInFlight || repoMutationInProgress(state))
    return;
  void refreshGitOverview(projectId, repo, {
    silent: true,
    onlyIfChanged: true,
  });
}

export function selectGitProject(project: ProjectRecord): void {
  const state = ensureGitProjectState(project);
  if (!state.loaded && !state.reposRequestInFlight) {
    void refreshGitProject(project);
    return;
  }
  if (!state.reposRequestInFlight) {
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

export function invalidateGitPanel(projectId?: string, repo?: string): void {
  const projects = projectId
    ? [gitPanelState.projects[gitProjectStateKey(projectId)]].filter(
        (project): project is GitPanelProjectState => Boolean(project),
      )
    : Object.values(gitPanelState.projects);
  for (const project of projects) {
    const id = project.projectId;
    if (repo) {
      void refreshGitOverview(id, repo, { force: true });
      void refreshGithub(id, repo);
    } else {
      void refreshGitProject(
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
  }
}
