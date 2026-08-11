import type {
  GitBranchSummary,
  GitFileChange,
  GitStashArea,
  GitStashEntry,
} from "$lib/api";
import {
  applyGitStash,
  createGitBranch,
  createGitStash,
  discardGitFile,
  dropGitStash,
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
import { gitFilesInScope, gitPathspecs } from "$lib/presentation";
import {
  refreshGitOverview,
  scheduleAutomaticGitRefresh,
} from "./git-panel-refresh.svelte";
import {
  ensureGitRepoState,
  errorMessage,
  mergeRepoSummary,
  setBranchesIfChanged,
} from "./git-panel-state.svelte";

function refreshAfterRemoteMutation(projectId: string, repo: string): void {
  scheduleAutomaticGitRefresh(projectId, repo, {
    overview: true,
    prs: true,
  });
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
    refreshAfterRemoteMutation(projectId, repo);
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
    refreshAfterRemoteMutation(projectId, repo);
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
    refreshAfterRemoteMutation(projectId, repo);
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
    refreshAfterRemoteMutation(projectId, repo);
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
    refreshAfterRemoteMutation(projectId, repo);
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
    refreshAfterRemoteMutation(projectId, repo);
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
    refreshAfterRemoteMutation(projectId, repo);
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
  } catch (error) {
    notifyGitFailure(
      `${action[0].toUpperCase()}${action.slice(1)} failed`,
      error,
    );
  } finally {
    await refreshGitOverview(projectId, repo, { force: true });
    state.operations.fileMutation = undefined;
  }
}

export async function mutateGitFileScope(
  projectId: string,
  repo: string,
  area: GitStashArea,
  action: "stage" | "unstage" | "discard",
  path?: string,
): Promise<void> {
  const state = ensureGitRepoState(projectId, repo);
  const targets = gitFilesInScope(state.changes?.files ?? [], area, path);
  if (targets.length === 0) return;
  const fn =
    action === "stage"
      ? stageGitFile
      : action === "unstage"
        ? unstageGitFile
        : discardGitFile;
  state.operations.bulkMutation = {
    action,
    area,
    ...(path ? { path } : {}),
  };
  try {
    for (const file of targets) await fn(projectId, repo, file.path);
  } catch (error) {
    notifyGitFailure(
      `${action[0]?.toUpperCase()}${action.slice(1)} changes failed`,
      error,
    );
  } finally {
    await refreshGitOverview(projectId, repo, { force: true });
    state.operations.bulkMutation = undefined;
  }
}

export async function createGitRepoStash(
  projectId: string,
  repo: string,
  area: GitStashArea,
  path?: string,
): Promise<void> {
  const state = ensureGitRepoState(projectId, repo);
  const scopedFiles = path
    ? gitFilesInScope(state.changes?.files ?? [], area, path)
    : undefined;
  if (path && scopedFiles?.length === 0) return;
  state.operations.stashMutation = {
    action: "create",
    area,
    ...(path ? { path } : {}),
  };
  try {
    const result = await createGitStash(
      projectId,
      repo,
      area,
      scopedFiles ? gitPathspecs(scopedFiles) : undefined,
    );
    mergeRepoSummary(projectId, result.repo);
    notify.success("Changes stashed");
  } catch (error) {
    notifyGitFailure("Stash failed", error);
  } finally {
    await refreshGitOverview(projectId, repo, { force: true });
    state.operations.stashMutation = undefined;
  }
}

export async function applyGitRepoStash(
  projectId: string,
  repo: string,
  stash: GitStashEntry,
): Promise<void> {
  const state = ensureGitRepoState(projectId, repo);
  state.operations.stashMutation = { action: "apply", hash: stash.hash };
  try {
    const result = await applyGitStash(
      projectId,
      repo,
      stash.index,
      stash.hash,
    );
    mergeRepoSummary(projectId, result.repo);
    notify.success("Stash applied");
  } catch (error) {
    notifyGitFailure("Apply stash failed", error);
  } finally {
    await refreshGitOverview(projectId, repo, { force: true });
    state.operations.stashMutation = undefined;
  }
}

export async function dropGitRepoStash(
  projectId: string,
  repo: string,
  stash: GitStashEntry,
): Promise<void> {
  const state = ensureGitRepoState(projectId, repo);
  state.operations.stashMutation = { action: "drop", hash: stash.hash };
  try {
    const result = await dropGitStash(projectId, repo, stash.index, stash.hash);
    mergeRepoSummary(projectId, result.repo);
    notify.success("Stash dropped");
  } catch (error) {
    notifyGitFailure("Drop stash failed", error);
  } finally {
    await refreshGitOverview(projectId, repo, { force: true });
    state.operations.stashMutation = undefined;
  }
}
