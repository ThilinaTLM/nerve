import type {
  GitBranchSummary,
  GithubPr,
  GithubStatusResponse,
  GitOverviewResponse,
  GitRepoSummary,
  ProjectRecord,
} from "$lib/api";
import {
  gitProjectStateKey,
  gitRepoStateKey,
} from "$lib/core/state/state-keys";
import type { GitContext } from "$lib/core/types/state-types";
import { gitState } from "$lib/features/git/state/git-state.svelte";
import { gitContextFingerprint } from "./git-context-helpers";

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
  const state = gitPanelState.projects[gitProjectStateKey(projectId)];
  if (!state) return;
  state.touchedAt = Date.now();
  pruneProjectCache();
}

function pruneProjectCache(): void {
  const entries = Object.values(gitPanelState.projects).sort(
    (a, b) => b.touchedAt - a.touchedAt,
  );
  for (const stale of entries.slice(MAX_PROJECT_CACHE_ENTRIES)) {
    delete gitPanelState.projects[gitProjectStateKey(stale.projectId)];
  }
}

export function ensureGitProjectState(
  project: ProjectRecord,
): GitPanelProjectState {
  const key = gitProjectStateKey(project.id);
  gitPanelState.projects[key] ??= createProjectState(project);
  const state = gitPanelState.projects[key];
  state.projectDir = project.dir;
  touchProject(project.id);
  return state;
}

export function ensureGitRepoState(
  projectId: string,
  repo: string,
): GitPanelRepoState {
  const project = gitPanelState.projects[gitProjectStateKey(projectId)];
  if (!project) return createRepoState();
  const key = gitRepoStateKey(repo);
  project.repoStates[key] ??= createRepoState();
  return project.repoStates[key];
}

export function errorMessage(error: unknown): string {
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
      hasGithubRemote: next.repo.hasGithubRemote,
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

export function mergeRepoSummary(
  projectId: string,
  next: GitRepoSummary,
): void {
  const project = gitPanelState.projects[gitProjectStateKey(projectId)];
  if (!project) return;
  const exists = project.repos.some(
    (repo) => repo.relativePath === next.relativePath,
  );
  project.repos = exists
    ? project.repos.map((repo) =>
        repo.relativePath === next.relativePath ? next : repo,
      )
    : [...project.repos, next];
  const state = project.repoStates[gitRepoStateKey(next.relativePath)];
  if (
    state?.overview &&
    state.overview.repo.relativePath === next.relativePath
  ) {
    state.overview = { ...state.overview, repo: next };
  }
  if (state && (!next.hasRemote || !next.hasGithubRemote)) {
    state.github = undefined;
    state.prs = [];
    state.loadingPrs = false;
    state.prsRequestInFlight = false;
  }
  applyGitContextFromProject(projectId);
}

function repoSummaryFor(
  projectId: string,
  repo: string,
): GitRepoSummary | undefined {
  const project = gitPanelState.projects[gitProjectStateKey(projectId)];
  if (!project) return undefined;
  return (
    project.repoStates[gitRepoStateKey(repo)]?.overview?.repo ??
    project.repos.find((candidate) => candidate.relativePath === repo)
  );
}

export function repoHasGithubRemote(projectId: string, repo: string): boolean {
  const summary = repoSummaryFor(projectId, repo);
  return Boolean(summary?.hasRemote && summary.hasGithubRemote);
}

export function clearGithubState(
  projectId: string,
  state: GitPanelRepoState,
): void {
  state.github = undefined;
  state.prs = [];
  state.loadingPrs = false;
  state.prsRequestInFlight = false;
  applyGitContextFromProject(projectId);
}

export function storedRepo(projectId: string): string | undefined {
  if (typeof localStorage === "undefined") return undefined;
  return localStorage.getItem(repoStorageKey(projectId)) ?? undefined;
}

export function saveSelectedRepo(projectId: string, repo: string): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(repoStorageKey(projectId), repo);
}

function gitContextFromProject(
  project: GitPanelProjectState,
): GitContext | undefined {
  if (!project.loaded && project.repos.length === 0) return undefined;
  const selectedState =
    project.repoStates[gitRepoStateKey(project.selectedRepo)];
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
  const project = gitPanelState.projects[gitProjectStateKey(projectId)];
  if (!project) return;
  const next = gitContextFromProject(project);
  if (!next) return;
  const current = gitState.gitContext;
  const changed =
    !current ||
    current.projectId !== next.projectId ||
    gitContextFingerprint(current) !== gitContextFingerprint(next);
  gitState.gitContext = changed
    ? next
    : { ...current, loadedAt: next.loadedAt };
}

export function selectedGitProjectState(
  projectId: string | undefined,
): GitPanelProjectState | undefined {
  return projectId
    ? gitPanelState.projects[gitProjectStateKey(projectId)]
    : undefined;
}

export function selectedGitRepoState(
  projectId: string | undefined,
): GitPanelRepoState | undefined {
  const project = selectedGitProjectState(projectId);
  if (!project) return undefined;
  return project.repoStates[gitRepoStateKey(project.selectedRepo)];
}
