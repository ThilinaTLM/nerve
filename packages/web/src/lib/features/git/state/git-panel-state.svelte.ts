import type {
  GitBranchSummary,
  GithubPr,
  GithubStatusResponse,
  GitOverviewResponse,
  GitRecentCommit,
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
import {
  branchesFingerprint,
  changesFingerprint,
  changesFromOverview,
  type GitChangesState,
  githubStatusFingerprint,
  prsFingerprint,
  recentCommitsFingerprint,
  repoSummaryFingerprint,
  reposFingerprint,
} from "./git-panel-slices";

export type FileMutation = {
  path: string;
  action: "stage" | "unstage" | "discard";
};

export type GitPanelOperationsState = {
  fetching: boolean;
  syncing: boolean;
  switchingBranch?: string;
  creatingBranch: boolean;
  fileMutation?: FileMutation;
  bulkMutation?: "stage-all" | "unstage-all";
};

export type GitPanelLoadStatus = "idle" | "loading" | "refreshing" | "error";

export type GitPanelRepoState = {
  repoSummary?: GitRepoSummary;
  changes?: GitChangesState;
  recentCommits: GitRecentCommit[];
  github?: GithubStatusResponse;
  prs: GithubPr[];
  branches: GitBranchSummary[];
  operations: GitPanelOperationsState;
  loadingOverview: boolean;
  loadingPrs: boolean;
  loadingBranches: boolean;
  prsRequestInFlight: boolean;
  overviewRequestInFlight: boolean;
  lastRepoSummaryFingerprint?: string;
  lastChangesFingerprint?: string;
  lastRecentCommitsFingerprint?: string;
  lastBranchesFingerprint?: string;
  lastPrsFingerprint?: string;
  lastGithubFingerprint?: string;
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
  lastReposFingerprint?: string;
  loaded: boolean;
  loadedAt?: number;
  requestSeq: number;
  touchedAt: number;
};

export type GitOverviewPatchResult = {
  changed: boolean;
  repoChanged: boolean;
  changesChanged: boolean;
  recentCommitsChanged: boolean;
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

function createOperationsState(): GitPanelOperationsState {
  return {
    fetching: false,
    syncing: false,
    switchingBranch: undefined,
    creatingBranch: false,
    fileMutation: undefined,
    bulkMutation: undefined,
  };
}

function createRepoState(): GitPanelRepoState {
  return {
    repoSummary: undefined,
    changes: undefined,
    recentCommits: [],
    github: undefined,
    prs: [],
    branches: [],
    operations: createOperationsState(),
    loadingOverview: false,
    loadingPrs: false,
    loadingBranches: false,
    prsRequestInFlight: false,
    overviewRequestInFlight: false,
    lastRepoSummaryFingerprint: undefined,
    lastChangesFingerprint: undefined,
    lastRecentCommitsFingerprint: undefined,
    lastBranchesFingerprint: undefined,
    lastPrsFingerprint: undefined,
    lastGithubFingerprint: undefined,
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
    lastReposFingerprint: undefined,
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
  if (state.projectDir !== project.dir) state.projectDir = project.dir;
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
  const operations = state?.operations;
  return Boolean(
    operations &&
      (operations.fetching ||
        operations.syncing ||
        operations.creatingBranch ||
        operations.switchingBranch ||
        operations.fileMutation ||
        operations.bulkMutation),
  );
}

export function patchRepoSummaryState(
  state: GitPanelRepoState,
  next: GitRepoSummary,
): boolean {
  const fingerprint = repoSummaryFingerprint(next);
  if (state.lastRepoSummaryFingerprint === fingerprint && state.repoSummary) {
    return false;
  }
  state.repoSummary = next;
  state.lastRepoSummaryFingerprint = fingerprint;
  return true;
}

export function patchChangesState(
  state: GitPanelRepoState,
  next: GitChangesState,
): boolean {
  const fingerprint = changesFingerprint(next);
  if (state.lastChangesFingerprint === fingerprint && state.changes) {
    return false;
  }
  state.changes = next;
  state.lastChangesFingerprint = fingerprint;
  return true;
}

export function patchRecentCommitsState(
  state: GitPanelRepoState,
  next: GitRecentCommit[],
): boolean {
  const fingerprint = recentCommitsFingerprint(next);
  if (state.lastRecentCommitsFingerprint === fingerprint) return false;
  state.recentCommits = next;
  state.lastRecentCommitsFingerprint = fingerprint;
  return true;
}

export function patchGitOverviewState(
  state: GitPanelRepoState,
  next: GitOverviewResponse,
): GitOverviewPatchResult {
  const repoChanged = patchRepoSummaryState(state, next.repo);
  const changesChanged = patchChangesState(state, changesFromOverview(next));
  const recentCommitsChanged = patchRecentCommitsState(
    state,
    next.recentCommits,
  );
  const changed = repoChanged || changesChanged || recentCommitsChanged;
  if (!state.loaded) state.loaded = true;
  if (changed || state.loadedAt === undefined) state.loadedAt = Date.now();
  return { changed, repoChanged, changesChanged, recentCommitsChanged };
}

export function setProjectRepos(
  project: GitPanelProjectState,
  repos: GitRepoSummary[],
): boolean {
  const fingerprint = reposFingerprint(repos);
  if (project.lastReposFingerprint === fingerprint) return false;
  project.repos = repos;
  project.lastReposFingerprint = fingerprint;
  return true;
}

export function setBranchesIfChanged(
  state: GitPanelRepoState,
  branches: GitBranchSummary[],
): boolean {
  const fingerprint = branchesFingerprint(branches);
  if (state.lastBranchesFingerprint === fingerprint) return false;
  state.branches = branches;
  state.lastBranchesFingerprint = fingerprint;
  return true;
}

export function setGithubStatusIfChanged(
  state: GitPanelRepoState,
  github: GithubStatusResponse | undefined,
): boolean {
  const fingerprint = githubStatusFingerprint(github);
  if (state.lastGithubFingerprint === fingerprint) return false;
  state.github = github;
  state.lastGithubFingerprint = fingerprint;
  return true;
}

export function setPrsIfChanged(
  state: GitPanelRepoState,
  prs: GithubPr[],
): boolean {
  const fingerprint = prsFingerprint(prs);
  if (state.lastPrsFingerprint === fingerprint) return false;
  state.prs = prs;
  state.lastPrsFingerprint = fingerprint;
  return true;
}

export function mergeRepoSummary(
  projectId: string,
  next: GitRepoSummary,
): void {
  const project = gitPanelState.projects[gitProjectStateKey(projectId)];
  if (!project) return;
  const existing = project.repos.find(
    (repo) => repo.relativePath === next.relativePath,
  );
  if (!existing) {
    setProjectRepos(project, [...project.repos, next]);
  } else if (
    repoSummaryFingerprint(existing) !== repoSummaryFingerprint(next)
  ) {
    setProjectRepos(
      project,
      project.repos.map((repo) =>
        repo.relativePath === next.relativePath ? next : repo,
      ),
    );
  }

  const state = project.repoStates[gitRepoStateKey(next.relativePath)];
  if (state) patchRepoSummaryState(state, next);
  if (state && (!next.hasRemote || !next.hasGithubRemote)) {
    clearGithubState(projectId, state);
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
    project.repoStates[gitRepoStateKey(repo)]?.repoSummary ??
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
  let changed = false;
  if (state.github !== undefined || state.lastGithubFingerprint !== undefined) {
    state.github = undefined;
    state.lastGithubFingerprint = undefined;
    changed = true;
  }
  const emptyPrsFingerprint = prsFingerprint([]);
  if (
    state.prs.length > 0 ||
    (state.lastPrsFingerprint !== undefined &&
      state.lastPrsFingerprint !== emptyPrsFingerprint)
  ) {
    state.prs = [];
    state.lastPrsFingerprint = emptyPrsFingerprint;
    changed = true;
  }
  if (state.loadingPrs) {
    state.loadingPrs = false;
    changed = true;
  }
  if (state.prsRequestInFlight) {
    state.prsRequestInFlight = false;
    changed = true;
  }
  if (changed) applyGitContextFromProject(projectId);
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
  if (changed) gitState.gitContext = next;
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
