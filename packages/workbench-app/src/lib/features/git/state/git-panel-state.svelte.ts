import { SvelteSet } from "svelte/reactivity";
import { activityInbox } from "$lib/application/activity/activity-state.svelte";
import { gitRemoteBusy } from "./git-operation-tracking";
import { gitProjectView } from "./git-panel-view-state.svelte";
import type {
  GitBranchSummary,
  GithubStatusResponse,
} from "@nervekit/contracts/git";
import {
  gitProjectStateKey,
  gitRepoStateKey,
} from "$lib/domain/navigation/view-keys";
import type { GitContext } from "$lib/features/git/state/git-state.svelte";
import type { GitPanelOperationState } from "../views/git-panel-types";
import { gitState } from "$lib/features/git/state/git-state.svelte";
import { defaultSelectedWorktree } from "../views/git-repo-tree";
import { gitContextFingerprint } from "./git-context-helpers";
import {
  loadCollapsedGitFolders,
  saveCollapsedGitFolders,
} from "./git-change-tree-expansion";
import {
  branchesFingerprint,
  githubStatusFingerprint,
} from "./git-panel-slices";
import { gitWorkspaceSnapshot } from "./git-store.svelte";

export type GitPanelOperationsState = {
  -readonly [Key in keyof GitPanelOperationState]: GitPanelOperationState[Key];
};

/** Client-only state of one worktree; summaries, files and stashes live in the git store. */
export type GitPanelRepoState = {
  github?: GithubStatusResponse;
  branches: GitBranchSummary[];
  collapsedChangeTreeFolders: SvelteSet<string>;
  operations: GitPanelOperationsState;
  loadingBranches: boolean;
  lastBranchesFingerprint?: string;
  lastGithubFingerprint?: string;
};

export type GitPanelProjectState = {
  projectId: string;
  repoStates: Record<string, GitPanelRepoState>;
  touchedAt: number;
};

export const gitPanelState = $state({
  projects: {} as Record<string, GitPanelProjectState>,
});

const MAX_PROJECT_CACHE_ENTRIES = 8;
function createOperationsState(
  projectId?: string,
  repo?: string,
): GitPanelOperationsState {
  const remote = () =>
    gitRemoteBusy(activityInbox.activities, projectId ?? "", repo ?? ".");
  return {
    get fetching() {
      return remote().fetching;
    },
    get pulling() {
      return remote().pulling;
    },
    get pushing() {
      return remote().pushing;
    },
    get syncing() {
      return remote().syncing;
    },
    get switchingBaseAndPulling() {
      return remote().switchingBaseAndPulling;
    },
    switchingBranch: undefined,
    deletingBranch: undefined,
    creatingBranch: false,
    fileMutation: undefined,
    bulkMutation: undefined,
    stashMutation: undefined,
  };
}

function createRepoState(projectId?: string, repo?: string): GitPanelRepoState {
  return {
    branches: [],
    collapsedChangeTreeFolders: new SvelteSet(
      projectId && repo ? loadCollapsedGitFolders(projectId, repo) : [],
    ),
    operations: createOperationsState(projectId, repo),
    loadingBranches: false,
  };
}

function createProjectState(projectId: string): GitPanelProjectState {
  return { projectId, repoStates: {}, touchedAt: Date.now() };
}

function pruneProjectCache(): void {
  const entries = Object.values(gitPanelState.projects).sort(
    (a, b) => b.touchedAt - a.touchedAt,
  );
  for (const stale of entries.slice(MAX_PROJECT_CACHE_ENTRIES)) {
    delete gitPanelState.projects[gitProjectStateKey(stale.projectId)];
  }
}

export function ensureGitRepoState(
  projectId: string,
  repo: string,
): GitPanelRepoState {
  const key = gitProjectStateKey(projectId);
  const created = !gitPanelState.projects[key];
  const project = (gitPanelState.projects[key] ??=
    createProjectState(projectId));
  project.touchedAt = Date.now();
  if (created) pruneProjectCache();
  return (project.repoStates[gitRepoStateKey(repo)] ??= createRepoState(
    projectId,
    repo,
  ));
}

export function setGitChangeTreeFolderExpanded(
  projectId: string,
  repo: string,
  key: string,
  expanded: boolean,
): void {
  const state = ensureGitRepoState(projectId, repo);
  if (expanded) state.collapsedChangeTreeFolders.delete(key);
  else state.collapsedChangeTreeFolders.add(key);
  saveCollapsedGitFolders(projectId, repo, state.collapsedChangeTreeFolders);
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

export function repoHasGithubRemote(projectId: string, repo: string): boolean {
  const summary = gitWorkspaceSnapshot(projectId)?.summaries.find(
    (candidate) => candidate.relativePath === repo,
  );
  return Boolean(summary?.hasRemote && summary.hasGithubRemote);
}

export function clearGithubState(
  projectId: string,
  state: GitPanelRepoState,
): void {
  if (state.github === undefined && state.lastGithubFingerprint === undefined)
    return;
  state.github = undefined;
  state.lastGithubFingerprint = undefined;
  applyGitContextFromProject(projectId);
}

/**
 * The selected worktree of a project: the remembered choice while it still
 * exists, else the default worktree of the snapshot.
 */
export function selectedGitRepo(projectId: string): string {
  const repos = gitWorkspaceSnapshot(projectId)?.summaries ?? [];
  const stored = gitProjectView(projectId).selected;
  if (stored && repos.some((repo) => repo.relativePath === stored))
    return stored;
  return defaultSelectedWorktree(repos) ?? repos[0]?.relativePath ?? ".";
}

export function selectGitRepo(projectId: string, repo: string): void {
  if (repo === selectedGitRepo(projectId)) return;
  gitProjectView(projectId).select(repo);
  applyGitContextFromProject(projectId);
}

function gitContextFromWorkspace(projectId: string): GitContext | undefined {
  const snapshot = gitWorkspaceSnapshot(projectId);
  if (!snapshot?.loaded) return undefined;
  const github =
    gitPanelState.projects[gitProjectStateKey(projectId)]?.repoStates[
      gitRepoStateKey(selectedGitRepo(projectId))
    ]?.github;
  return {
    projectId,
    projectIsRepo: snapshot.projectIsRepo,
    repos: snapshot.summaries,
    github: github
      ? { available: github.available, authenticated: github.authenticated }
      : undefined,
    loadedAt: Date.now(),
  };
}

export function applyGitContextFromProject(projectId: string): void {
  const next = gitContextFromWorkspace(projectId);
  if (!next) return;
  const current = gitState.gitContext;
  const changed =
    !current ||
    current.projectId !== next.projectId ||
    gitContextFingerprint(current) !== gitContextFingerprint(next);
  if (changed) gitState.gitContext = next;
}
