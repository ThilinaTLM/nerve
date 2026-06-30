import type { GitBranchSummary, GitFileChange } from "$lib/api";
import {
  createGitBranch,
  discardGitFile,
  fetchGit,
  pullGit,
  pushGit,
  stageGitFile,
  switchBaseAndPullGit,
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
  setBranchesIfChanged,
} from "./git-panel-state.svelte";

async function refreshAfterRemoteMutation(
  projectId: string,
  repo: string,
): Promise<void> {
  const state = ensureGitRepoState(projectId, repo);
  await refreshGitOverview(projectId, repo);
  if (state.github?.authenticated) await refreshPrs(projectId, repo, true);
}

function notifyGitFailure(title: string, error: unknown): void {
  notify.error(title, { description: errorMessage(error) });
}

export async function fetchGitRepo(
  projectId: string,
  repo: string,
): Promise<void> {
  const state = ensureGitRepoState(projectId, repo);
  state.operations.fetching = true;
  try {
    const result = await fetchGit(projectId, repo);
    mergeRepoSummary(projectId, result.repo);
    notify.success("Fetched from remote");
    await refreshAfterRemoteMutation(projectId, repo);
  } catch (error) {
    notifyGitFailure("Fetch failed", error);
  } finally {
    state.operations.fetching = false;
  }
}

export async function pullGitRepo(
  projectId: string,
  repo: string,
): Promise<void> {
  const state = ensureGitRepoState(projectId, repo);
  state.operations.pulling = true;
  try {
    const result = await pullGit(projectId, repo);
    mergeRepoSummary(projectId, result.repo);
    notify.success("Pulled from upstream");
    await refreshAfterRemoteMutation(projectId, repo);
  } catch (error) {
    notifyGitFailure("Pull failed", error);
  } finally {
    state.operations.pulling = false;
  }
}

export async function pushGitRepo(
  projectId: string,
  repo: string,
): Promise<void> {
  const state = ensureGitRepoState(projectId, repo);
  state.operations.pushing = true;
  try {
    const result = await pushGit(projectId, repo);
    mergeRepoSummary(projectId, result.repo);
    notify.success("Pushed to upstream");
    await refreshAfterRemoteMutation(projectId, repo);
  } catch (error) {
    notifyGitFailure("Push failed", error);
  } finally {
    state.operations.pushing = false;
  }
}

export async function syncGitRepo(
  projectId: string,
  repo: string,
): Promise<void> {
  const state = ensureGitRepoState(projectId, repo);
  state.operations.syncing = true;
  try {
    const result = await syncGitBranch(projectId, repo);
    mergeRepoSummary(projectId, result.repo);
    notify.success("Branch synced");
    await refreshAfterRemoteMutation(projectId, repo);
  } catch (error) {
    notifyGitFailure("Sync failed", error);
  } finally {
    state.operations.syncing = false;
  }
}

export async function switchBaseAndPullGitRepo(
  projectId: string,
  repo: string,
): Promise<void> {
  const state = ensureGitRepoState(projectId, repo);
  state.operations.switchingBaseAndPulling = true;
  try {
    const result = await switchBaseAndPullGit(projectId, repo);
    mergeRepoSummary(projectId, result.repo);
    setBranchesIfChanged(state, []);
    notify.success(`Switched to ${result.repo.baseBranch} and pulled`);
    await Promise.all([
      refreshAfterRemoteMutation(projectId, repo),
      refreshGithub(projectId, repo),
    ]);
  } catch (error) {
    notifyGitFailure("Switch and pull failed", error);
  } finally {
    state.operations.switchingBaseAndPulling = false;
  }
}

export async function switchGitRepoBranch(
  projectId: string,
  repo: string,
  branch: GitBranchSummary,
): Promise<boolean> {
  if (branch.current) return false;
  const state = ensureGitRepoState(projectId, repo);
  state.operations.switchingBranch = branch.name;
  try {
    const result = await switchGitBranch(projectId, repo, branch.name);
    mergeRepoSummary(projectId, result.repo);
    setBranchesIfChanged(state, []);
    notify.success(`Switched to ${result.repo.currentBranch ?? branch.name}`);
    await Promise.all([
      refreshGitOverview(projectId, repo),
      refreshGithub(projectId, repo),
    ]);
    return true;
  } catch (error) {
    notifyGitFailure("Switch branch failed", error);
    return false;
  } finally {
    state.operations.switchingBranch = undefined;
  }
}

export async function createGitRepoBranch(
  projectId: string,
  repo: string,
  name: string,
): Promise<boolean> {
  if (name.trim().length === 0) return false;
  const state = ensureGitRepoState(projectId, repo);
  state.operations.creatingBranch = true;
  try {
    const result = await createGitBranch(projectId, repo, name.trim());
    mergeRepoSummary(projectId, result.repo);
    setBranchesIfChanged(state, []);
    notify.success(`Created branch ${name.trim()}`);
    await Promise.all([
      refreshGitOverview(projectId, repo),
      refreshGithub(projectId, repo),
    ]);
    return true;
  } catch (error) {
    notifyGitFailure("Create branch failed", error);
    return false;
  } finally {
    state.operations.creatingBranch = false;
  }
}

export async function mutateGitFile(
  projectId: string,
  repo: string,
  file: GitFileChange,
  action: "stage" | "unstage" | "discard",
): Promise<void> {
  const state = ensureGitRepoState(projectId, repo);
  state.operations.fileMutation = { path: file.path, action };
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
    notifyGitFailure(
      `${action[0].toUpperCase()}${action.slice(1)} failed`,
      error,
    );
  } finally {
    state.operations.fileMutation = undefined;
  }
}

export async function bulkStageGitFiles(
  projectId: string,
  repo: string,
  action: "stage-all" | "unstage-all",
): Promise<void> {
  const state = ensureGitRepoState(projectId, repo);
  const files = state.changes?.files ?? [];
  const targets =
    action === "stage-all"
      ? files.filter((file) => file.untracked || file.worktree !== " ")
      : files.filter((file) => file.staged);
  if (targets.length === 0) return;
  const fn = action === "stage-all" ? stageGitFile : unstageGitFile;
  state.operations.bulkMutation = action;
  try {
    for (const file of targets) {
      await fn(projectId, repo, file.path);
    }
    await refreshGitOverview(projectId, repo);
  } catch (error) {
    notifyGitFailure(
      `${action === "stage-all" ? "Stage all" : "Unstage all"} failed`,
      error,
    );
  } finally {
    state.operations.bulkMutation = undefined;
  }
}
