import { activityInbox } from "$lib/application/activity/activity-state.svelte";
import { observeGitOperationStart } from "./git-operation-tracking";
import type {
  GitOperationStartRequest,
  GitBranchSummary,
  GitFileChange,
  GitStashArea,
  GitStashEntry,
} from "@nervekit/contracts/git";
import {
  startGitOperation,
  applyGitStash,
  createGitBranch,
  createGitStash,
  deleteGitBranch,
  discardGitFile,
  dropGitStash,
  stageGitFile,
  switchGitBranch,
  unstageGitFile,
} from "../api/git.api";
import {
  errorDetails,
  showCriticalError,
} from "$lib/application/notifications/critical-errors.svelte";
import { notify } from "$lib/application/notifications/notify.svelte";
import { gitFilesInScope, gitPathspecs } from "../views/git-panel-controller";
import { refreshBranches } from "./git-panel-refresh.svelte";
import {
  ensureGitRepoState,
  setBranchesIfChanged,
} from "./git-panel-state.svelte";
import { awaitGitWorkspaceRevision, gitRepoDetail } from "./git-store.svelte";

function notifyGitFailure(title: string, error: unknown): void {
  showCriticalError(title, errorDetails(error));
}

async function submitGitOperation(
  input: GitOperationStartRequest,
): Promise<void> {
  try {
    const { operationId } = await startGitOperation(input);
    // The canonical Activity controller owns acknowledgements and terminal state.
    observeGitOperationStart(activityInbox, input, operationId);
  } catch (error) {
    notifyGitFailure("Could not start Git operation", error);
  }
}
export function fetchGitRepo(projectId: string, repo: string): Promise<void> {
  return submitGitOperation({ projectId, repo, kind: "fetch" });
}
export function pullGitRepo(projectId: string, repo: string): Promise<void> {
  return submitGitOperation({ projectId, repo, kind: "pull" });
}
export function pushGitRepo(projectId: string, repo: string): Promise<void> {
  return submitGitOperation({ projectId, repo, kind: "push" });
}
export function syncGitRepo(projectId: string, repo: string): Promise<void> {
  return submitGitOperation({ projectId, repo, kind: "sync" });
}
export function switchBaseAndPullGitRepo(
  projectId: string,
  repo: string,
): Promise<void> {
  return submitGitOperation({ projectId, repo, kind: "switchBaseAndPull" });
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
    await awaitGitWorkspaceRevision(projectId, result.workspaceRevision, repo);
    setBranchesIfChanged(state, []);
    notify.success(`Switched to ${result.repo.currentBranch ?? branch.name}`);
    return true;
  } catch (error) {
    notifyGitFailure("Switch branch failed", error);
    return false;
  } finally {
    state.operations.switchingBranch = undefined;
  }
}

export async function deleteGitRepoBranch(
  projectId: string,
  repo: string,
  branch: GitBranchSummary,
): Promise<boolean> {
  if (branch.current || branch.remote) return false;
  const state = ensureGitRepoState(projectId, repo);
  state.operations.deletingBranch = branch.name;
  try {
    const result = await deleteGitBranch(projectId, repo, branch.name);
    setBranchesIfChanged(state, []);
    notify.success(`Deleted branch ${branch.name}`);
    await Promise.all([
      refreshBranches(projectId, repo, undefined, true),
      awaitGitWorkspaceRevision(projectId, result.workspaceRevision, repo),
    ]);
    return true;
  } catch (error) {
    notifyGitFailure("Delete branch failed", error);
    return false;
  } finally {
    state.operations.deletingBranch = undefined;
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
    await awaitGitWorkspaceRevision(projectId, result.workspaceRevision, repo);
    setBranchesIfChanged(state, []);
    notify.success(`Created branch ${name.trim()}`);
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
  let revision: number | undefined;
  try {
    const fn =
      action === "stage"
        ? stageGitFile
        : action === "unstage"
          ? unstageGitFile
          : discardGitFile;
    revision = (await fn(projectId, repo, file.path)).workspaceRevision;
  } catch (error) {
    notifyGitFailure(
      `${action[0].toUpperCase()}${action.slice(1)} failed`,
      error,
    );
  } finally {
    await awaitGitWorkspaceRevision(projectId, revision, repo);
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
  const targets = gitFilesInScope(
    gitRepoDetail(projectId, repo)?.files ?? [],
    area,
    path,
  );
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
  let revision: number | undefined;
  try {
    for (const file of targets)
      revision = (await fn(projectId, repo, file.path)).workspaceRevision;
  } catch (error) {
    notifyGitFailure(
      `${action[0]?.toUpperCase()}${action.slice(1)} changes failed`,
      error,
    );
  } finally {
    await awaitGitWorkspaceRevision(projectId, revision, repo);
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
    ? gitFilesInScope(gitRepoDetail(projectId, repo)?.files ?? [], area, path)
    : undefined;
  if (path && scopedFiles?.length === 0) return;
  state.operations.stashMutation = {
    action: "create",
    area,
    ...(path ? { path } : {}),
  };
  let revision: number | undefined;
  try {
    const result = await createGitStash(
      projectId,
      repo,
      area,
      scopedFiles ? gitPathspecs(scopedFiles) : undefined,
    );
    revision = result.workspaceRevision;
    notify.success("Changes stashed");
  } catch (error) {
    notifyGitFailure("Stash failed", error);
  } finally {
    await awaitGitWorkspaceRevision(projectId, revision, repo);
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
  let revision: number | undefined;
  try {
    const result = await applyGitStash(
      projectId,
      repo,
      stash.index,
      stash.hash,
    );
    revision = result.workspaceRevision;
    notify.success("Stash applied");
  } catch (error) {
    notifyGitFailure("Apply stash failed", error);
  } finally {
    await awaitGitWorkspaceRevision(projectId, revision, repo);
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
  let revision: number | undefined;
  try {
    const result = await dropGitStash(projectId, repo, stash.index, stash.hash);
    revision = result.workspaceRevision;
    notify.success("Stash dropped");
  } catch (error) {
    notifyGitFailure("Drop stash failed", error);
  } finally {
    await awaitGitWorkspaceRevision(projectId, revision, repo);
    state.operations.stashMutation = undefined;
  }
}
