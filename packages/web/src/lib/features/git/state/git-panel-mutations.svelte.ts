import type { GitBranchSummary, GitFileChange } from "$lib/api";
import {
  createGitBranch,
  discardGitFile,
  fetchGit,
  stageGitFile,
  switchGitBranch,
  syncGitBranch,
  unstageGitFile,
} from "$lib/api";
import { notify } from "$lib/features/notifications/notify.svelte";
import {
  refreshGithub,
  refreshGitOverview,
  refreshPrs,
} from "./git-panel-refresh.svelte";
import {
  ensureGitRepoState,
  errorMessage,
  mergeRepoSummary,
} from "./git-panel-state.svelte";

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
