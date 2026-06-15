import { notify } from "$lib/notifications/notify.svelte";
import {
  createGitBranch,
  discardGitFile,
  discoverGitRepos,
  fetchGit,
  type GitBranchSummary,
  type GitFileChange,
  type GithubPr,
  type GithubStatusResponse,
  type GitOverviewResponse,
  type GitRepoSummary,
  getGithubStatus,
  getGitOverview,
  listGitBranches,
  listGithubPrs,
  type ProjectRecord,
  stageGitFile,
  switchGitBranch,
  syncGitBranch,
  unstageGitFile,
} from "../../api";
import { gitContextFingerprint } from "./git-context-helpers";
import type { GitContext } from "./state.svelte";
import { workbenchState } from "./state.svelte";

export type FileMutation = {
  path: string;
  action: "stage" | "unstage" | "discard";
};

export type GitPanelLoadStatus = "idle" | "loading" | "refreshing" | "error";

export type GitPanelRepoState = {
  overview?: GitOverviewResponse;
  github?: GithubStatusResponse;
  prs: GithubPr[];
  branches: GitBranchSummary[];
  loadingOverview: boolean;
  loadingPrs: boolean;
  loadingBranches: boolean;
  prsRequestInFlight: boolean;
  fetching: boolean;
  syncing: boolean;
  switchingBranch?: string;
  creatingBranch: boolean;
  fileMutation?: FileMutation;
  bulkMutation?: "stage-all" | "unstage-all";
  lastOverviewFingerprint?: string;
  overviewRequestInFlight: boolean;
  loaded: boolean;
  loadedAt?: number;
  requestSeq: number;
};

export type GitPanelProjectState = {
  projectId: string;
  projectDir: string;
  projectIsRepo: boolean;
  repos: GitRepoSummary[];
  selectedRepo: string;
  repoStates: Record<string, GitPanelRepoState>;
  discoverError?: string;
  loadingRepos: boolean;
  refreshingRepos: boolean;
  reposRequestInFlight: boolean;
  loaded: boolean;
  loadedAt?: number;
  requestSeq: number;
  touchedAt: number;
};

export const gitPanelState = $state({
  projects: {} as Record<string, GitPanelProjectState>,
});

const MAX_PROJECT_CACHE_ENTRIES = 8;

export type GitPanelRefreshOptions = {
  silent?: boolean;
  force?: boolean;
  onlyIfChanged?: boolean;
};

function createRepoState(): GitPanelRepoState {
  return {
    overview: undefined,
    github: undefined,
    prs: [],
    branches: [],
    loadingOverview: false,
    loadingPrs: false,
    loadingBranches: false,
    prsRequestInFlight: false,
    fetching: false,
    syncing: false,
    switchingBranch: undefined,
    creatingBranch: false,
    fileMutation: undefined,
    bulkMutation: undefined,
    lastOverviewFingerprint: undefined,
    overviewRequestInFlight: false,
    loaded: false,
    loadedAt: undefined,
    requestSeq: 0,
  };
}

function createProjectState(project: ProjectRecord): GitPanelProjectState {
  return {
    projectId: project.id,
    projectDir: project.dir,
    projectIsRepo: false,
    repos: [],
    selectedRepo: ".",
    repoStates: {},
    discoverError: undefined,
    loadingRepos: false,
    refreshingRepos: false,
    reposRequestInFlight: false,
    loaded: false,
    loadedAt: undefined,
    requestSeq: 0,
    touchedAt: Date.now(),
  };
}

function repoStorageKey(projectId: string): string {
  return `nerve.git.repo.${projectId}`;
}

function touchProject(projectId: string): void {
  const state = gitPanelState.projects[projectId];
  if (!state) return;
  state.touchedAt = Date.now();
  pruneProjectCache();
}

function pruneProjectCache(): void {
  const entries = Object.values(gitPanelState.projects).sort(
    (a, b) => b.touchedAt - a.touchedAt,
  );
  for (const stale of entries.slice(MAX_PROJECT_CACHE_ENTRIES)) {
    delete gitPanelState.projects[stale.projectId];
  }
}

export function ensureGitProjectState(
  project: ProjectRecord,
): GitPanelProjectState {
  gitPanelState.projects[project.id] ??= createProjectState(project);
  const state = gitPanelState.projects[project.id];
  state.projectDir = project.dir;
  touchProject(project.id);
  return state;
}

export function ensureGitRepoState(
  projectId: string,
  repo: string,
): GitPanelRepoState {
  const project = gitPanelState.projects[projectId];
  if (!project) return createRepoState();
  project.repoStates[repo] ??= createRepoState();
  return project.repoStates[repo];
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    try {
      const parsed = JSON.parse(error.message);
      if (parsed?.error?.message) return String(parsed.error.message);
    } catch {
      // not JSON
    }
    return error.message;
  }
  return String(error);
}

export function repoMutationInProgress(
  state: GitPanelRepoState | undefined,
): boolean {
  return Boolean(
    state &&
      (state.fetching ||
        state.syncing ||
        state.creatingBranch ||
        state.switchingBranch ||
        state.fileMutation ||
        state.bulkMutation),
  );
}

export function overviewFingerprint(next: GitOverviewResponse): string {
  return JSON.stringify({
    repo: {
      currentBranch: next.repo.currentBranch,
      detached: next.repo.detached,
      ahead: next.repo.ahead,
      behind: next.repo.behind,
      hasUpstream: next.repo.hasUpstream,
      hasRemote: next.repo.hasRemote,
      baseBranch: next.repo.baseBranch,
      onBaseBranch: next.repo.onBaseBranch,
      mergedToBase: next.repo.mergedToBase,
    },
    counts: {
      staged: next.stagedCount,
      unstaged: next.unstagedCount,
      untracked: next.untrackedCount,
      insertions: next.insertions,
      deletions: next.deletions,
    },
    files: next.files.map((file) => ({
      path: file.path,
      renamedFrom: file.renamedFrom,
      index: file.index,
      worktree: file.worktree,
      staged: file.staged,
      untracked: file.untracked,
    })),
    latestCommit: next.recentCommits[0]?.hash ?? null,
  });
}

function mergeRepoSummary(projectId: string, next: GitRepoSummary): void {
  const project = gitPanelState.projects[projectId];
  if (!project) return;
  const exists = project.repos.some(
    (repo) => repo.relativePath === next.relativePath,
  );
  project.repos = exists
    ? project.repos.map((repo) =>
        repo.relativePath === next.relativePath ? next : repo,
      )
    : [...project.repos, next];
  const state = project.repoStates[next.relativePath];
  if (
    state?.overview &&
    state.overview.repo.relativePath === next.relativePath
  ) {
    state.overview = { ...state.overview, repo: next };
  }
  applyGitContextFromProject(projectId);
}

function storedRepo(projectId: string): string | undefined {
  if (typeof localStorage === "undefined") return undefined;
  return localStorage.getItem(repoStorageKey(projectId)) ?? undefined;
}

function saveSelectedRepo(projectId: string, repo: string): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(repoStorageKey(projectId), repo);
}

function gitContextFromProject(
  project: GitPanelProjectState,
): GitContext | undefined {
  if (!project.loaded && project.repos.length === 0) return undefined;
  const selectedState = project.repoStates[project.selectedRepo];
  return {
    projectId: project.projectId,
    projectIsRepo: project.projectIsRepo,
    repos: project.repos,
    github: selectedState?.github
      ? {
          available: selectedState.github.available,
          authenticated: selectedState.github.authenticated,
        }
      : undefined,
    loadedAt: project.loadedAt ?? Date.now(),
  };
}

export function applyGitContextFromProject(projectId: string): void {
  const project = gitPanelState.projects[projectId];
  if (!project) return;
  const next = gitContextFromProject(project);
  if (!next) return;
  const current = workbenchState.gitContext;
  const changed =
    !current ||
    current.projectId !== next.projectId ||
    gitContextFingerprint(current) !== gitContextFingerprint(next);
  workbenchState.gitContext = changed
    ? next
    : { ...current, loadedAt: next.loadedAt };
}

export function selectedGitProjectState(
  projectId: string | undefined,
): GitPanelProjectState | undefined {
  return projectId ? gitPanelState.projects[projectId] : undefined;
}

export function selectedGitRepoState(
  projectId: string | undefined,
): GitPanelRepoState | undefined {
  const project = selectedGitProjectState(projectId);
  if (!project) return undefined;
  return project.repoStates[project.selectedRepo];
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
  const project = gitPanelState.projects[projectId];
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
    state.projectIsRepo = result.projectIsRepo;
    state.repos = result.repos;
    for (const repo of result.repos)
      ensureGitRepoState(project.id, repo.relativePath);
    const stored = storedRepo(project.id);
    const currentExists = result.repos.some(
      (repo) => repo.relativePath === state.selectedRepo,
    );
    const fallback = result.repos[0]?.relativePath ?? ".";
    if (stored && result.repos.some((repo) => repo.relativePath === stored)) {
      state.selectedRepo = stored;
    } else if (!currentExists) {
      state.selectedRepo = fallback;
    }
    state.loaded = true;
    state.loadedAt = Date.now();
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
    if (!state.loaded) state.repos = [];
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
    const fingerprint = overviewFingerprint(next);
    if (
      !options.onlyIfChanged ||
      fingerprint !== state.lastOverviewFingerprint
    ) {
      state.overview = next;
    }
    state.lastOverviewFingerprint = fingerprint;
    state.loaded = true;
    state.loadedAt = Date.now();
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
    state.branches = result.branches;
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
  try {
    const status = await getGithubStatus(projectId, repo);
    state.github = status;
    applyGitContextFromProject(projectId);
    if (status.authenticated) {
      await refreshPrs(projectId, repo, true);
    } else {
      state.prs = [];
    }
  } catch (error) {
    state.github = {
      available: false,
      authenticated: false,
      login: null,
      reason: errorMessage(error),
    };
    state.prs = [];
    applyGitContextFromProject(projectId);
  }
}

export async function refreshPrs(
  projectId: string,
  repo: string,
  silent = false,
): Promise<void> {
  const state = ensureGitRepoState(projectId, repo);
  if (state.prsRequestInFlight) return;
  state.prsRequestInFlight = true;
  if (!silent) state.loadingPrs = true;
  try {
    const result = await listGithubPrs(projectId, repo);
    state.prs = result.prs;
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
  const state = gitPanelState.projects[projectId]?.repoStates[repo];
  if (!state || state.overviewRequestInFlight || repoMutationInProgress(state))
    return;
  void refreshGitOverview(projectId, repo, {
    silent: true,
    onlyIfChanged: true,
  });
}

export async function fetchGitRepo(
  projectId: string,
  repo: string,
): Promise<void> {
  const state = ensureGitRepoState(projectId, repo);
  state.fetching = true;
  try {
    const result = await fetchGit(projectId, repo);
    mergeRepoSummary(projectId, result.repo);
    notify.success("Fetched from remote");
    await refreshGitOverview(projectId, repo);
    if (state.github?.authenticated) await refreshPrs(projectId, repo, true);
  } catch (error) {
    notify.error(`Fetch failed: ${errorMessage(error)}`);
  } finally {
    state.fetching = false;
  }
}

export async function syncGitRepo(
  projectId: string,
  repo: string,
): Promise<void> {
  const state = ensureGitRepoState(projectId, repo);
  state.syncing = true;
  try {
    const result = await syncGitBranch(projectId, repo);
    mergeRepoSummary(projectId, result.repo);
    notify.success("Branch synced");
    await refreshGitOverview(projectId, repo);
    if (state.github?.authenticated) await refreshPrs(projectId, repo, true);
  } catch (error) {
    notify.error(`Sync failed: ${errorMessage(error)}`);
  } finally {
    state.syncing = false;
  }
}

export async function switchGitRepoBranch(
  projectId: string,
  repo: string,
  branch: GitBranchSummary,
): Promise<boolean> {
  if (branch.current) return false;
  const state = ensureGitRepoState(projectId, repo);
  state.switchingBranch = branch.name;
  try {
    const result = await switchGitBranch(projectId, repo, branch.name);
    mergeRepoSummary(projectId, result.repo);
    state.branches = [];
    notify.success(`Switched to ${result.repo.currentBranch ?? branch.name}`);
    await Promise.all([
      refreshGitOverview(projectId, repo),
      refreshGithub(projectId, repo),
    ]);
    return true;
  } catch (error) {
    notify.error(`Switch branch failed: ${errorMessage(error)}`);
    return false;
  } finally {
    state.switchingBranch = undefined;
  }
}

export async function createGitRepoBranch(
  projectId: string,
  repo: string,
  name: string,
): Promise<boolean> {
  if (name.trim().length === 0) return false;
  const state = ensureGitRepoState(projectId, repo);
  state.creatingBranch = true;
  try {
    const result = await createGitBranch(projectId, repo, name.trim());
    mergeRepoSummary(projectId, result.repo);
    state.branches = [];
    notify.success(`Created branch ${name.trim()}`);
    await Promise.all([
      refreshGitOverview(projectId, repo),
      refreshGithub(projectId, repo),
    ]);
    return true;
  } catch (error) {
    notify.error(`Create branch failed: ${errorMessage(error)}`);
    return false;
  } finally {
    state.creatingBranch = false;
  }
}

export async function mutateGitFile(
  projectId: string,
  repo: string,
  file: GitFileChange,
  action: "stage" | "unstage" | "discard",
): Promise<void> {
  const state = ensureGitRepoState(projectId, repo);
  state.fileMutation = { path: file.path, action };
  try {
    const fn =
      action === "stage"
        ? stageGitFile
        : action === "unstage"
          ? unstageGitFile
          : discardGitFile;
    const result = await fn(projectId, repo, file.path);
    mergeRepoSummary(projectId, result.repo);
    await refreshGitOverview(projectId, repo);
  } catch (error) {
    notify.error(
      `${action[0].toUpperCase()}${action.slice(1)} failed: ${errorMessage(error)}`,
    );
  } finally {
    state.fileMutation = undefined;
  }
}

export async function bulkStageGitFiles(
  projectId: string,
  repo: string,
  action: "stage-all" | "unstage-all",
): Promise<void> {
  const state = ensureGitRepoState(projectId, repo);
  const files = state.overview?.files ?? [];
  const targets =
    action === "stage-all"
      ? files.filter((file) => file.untracked || file.worktree !== " ")
      : files.filter((file) => file.staged);
  if (targets.length === 0) return;
  const fn = action === "stage-all" ? stageGitFile : unstageGitFile;
  state.bulkMutation = action;
  try {
    for (const file of targets) {
      await fn(projectId, repo, file.path);
    }
    await refreshGitOverview(projectId, repo);
  } catch (error) {
    notify.error(
      `${action === "stage-all" ? "Stage all" : "Unstage all"} failed: ${errorMessage(error)}`,
    );
  } finally {
    state.bulkMutation = undefined;
  }
}

export function invalidateGitPanel(projectId?: string, repo?: string): void {
  const projectIds = projectId
    ? [projectId]
    : Object.keys(gitPanelState.projects);
  for (const id of projectIds) {
    const project = gitPanelState.projects[id];
    if (!project) continue;
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
