import { gitState } from "$lib/features/git/state/git-state.svelte";
import { selection } from "$lib/application/workspace/selection.svelte";
import { refreshGithub } from "./git-panel-refresh.svelte";
import {
  applyGitContextFromProject,
  selectedGitRepo,
} from "./git-panel-state.svelte";
import {
  gitWorkspaceSnapshot,
  holdGitWorkspace,
  onGitWorkspaceChange,
  readGitWorkspace,
} from "./git-store.svelte";

export { gitContextFingerprint } from "./git-context-helpers";

let heldProjectId: string | undefined;
let release: (() => void) | undefined;

/**
 * Keep the active project's summaries live for as long as it is the active
 * project. Demand audit: the Git panel and the Files panel (decorations)
 * declare their own `visible` demand while mounted; the composer's prompt
 * suggestions read `gitState.gitContext` (dirty/ahead/behind/branch per
 * repository) whether or not either panel is open, so this is the one
 * always-on consumer. It costs summary reads of the active project only.
 */
function holdContextProject(projectId: string | undefined): void {
  if (heldProjectId === projectId) return;
  release?.();
  release = undefined;
  heldProjectId = projectId;
  if (projectId) release = holdGitWorkspace({ projectId, visible: true });
}

/** Mirrors the active project's workspace snapshot into `gitState.gitContext`. */
export function registerGitContextSync(): () => void {
  const stop = onGitWorkspaceChange((projectId) => {
    if (projectId === heldProjectId) applyGitContextFromProject(projectId);
  });
  return () => {
    stop();
    holdContextProject(undefined);
  };
}

export async function refreshGitContext(projectId?: string): Promise<void> {
  const id = projectId ?? selection.projectId;
  if (!id) return;
  holdContextProject(id);
  try {
    await readGitWorkspace(id);
    if (!gitWorkspaceSnapshot(id)?.loaded) return;
    await refreshGithub(id, selectedGitRepo(id));
    applyGitContextFromProject(id);
  } catch {
    // Discovery failed (not a repo, permissions, etc.) — drop context so no
    // suggestions are shown rather than surfacing an error.
    if (gitState.gitContext?.projectId === id) gitState.gitContext = undefined;
  }
}

export function clearGitContext(): void {
  holdContextProject(undefined);
  gitState.gitContext = undefined;
}

/** A Git or pull request mutation finished: pick up the server's latest state. */
export function invalidateGit(projectId?: string): void {
  const id = projectId ?? selection.projectId;
  if (id) void readGitWorkspace(id);
}
