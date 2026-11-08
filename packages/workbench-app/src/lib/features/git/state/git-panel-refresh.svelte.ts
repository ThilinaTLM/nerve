import { getGithubStatus, listGitBranches } from "../api/git.api";
import { queryClient, queryKeys } from "$lib/platform/query/client";
import { showCriticalError } from "$lib/application/notifications/critical-errors.svelte";
import { notify } from "$lib/application/notifications/notify.svelte";
import {
  applyGitContextFromProject,
  clearGithubState,
  ensureGitRepoState,
  errorMessage,
  repoHasGithubRemote,
  setBranchesIfChanged,
  setGithubStatusIfChanged,
} from "./git-panel-state.svelte";
import { GITHUB_STATUS_STALE_MS, GIT_STALE_MS } from "./git-refresh-policy";

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
