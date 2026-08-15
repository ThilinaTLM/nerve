import { SvelteSet } from "svelte/reactivity";
import type { GitContext } from "$lib/core/types/state-types";
import { gitState } from "$lib/features/git/state/git-state.svelte";
import { workspaceState } from "$lib/features/workspace/state/workspace-state.svelte";
import { gitContextFingerprint } from "./git-context-helpers";
import {
  applyGitContextFromProject,
  refreshGitProject,
  scheduleAutomaticProjectGitRefresh,
} from "./git-panel.svelte";

export { gitContextFingerprint } from "./git-context-helpers";

const GIT_CONTEXT_MIN_REFRESH_MS = 2_000;

type GitContextRefreshReason = "project" | "focus";

type GitContextRefreshOptions = {
  force?: boolean;
  reason?: GitContextRefreshReason;
};

const inFlight = new SvelteSet<string>();
let pendingRefreshTimer: number | undefined;
let lastRefreshStartedAt = 0;

function clearPendingRefresh(): void {
  if (pendingRefreshTimer === undefined || typeof window === "undefined")
    return;
  window.clearTimeout(pendingRefreshTimer);
  pendingRefreshTimer = undefined;
}

function scheduleRefresh(
  projectId: string,
  options: GitContextRefreshOptions,
  delayMs: number,
): void {
  if (pendingRefreshTimer !== undefined || typeof window === "undefined")
    return;
  pendingRefreshTimer = window.setTimeout(() => {
    pendingRefreshTimer = undefined;
    void refreshGitContext(projectId, { ...options, force: false });
  }, delayMs);
}

function applyGitContext(next: GitContext): void {
  const current = gitState.gitContext;
  const changed =
    !current ||
    current.projectId !== next.projectId ||
    gitContextFingerprint(current) !== gitContextFingerprint(next);

  if (changed) {
    gitState.gitContext = next;
  } else {
    gitState.gitContext = { ...current, loadedAt: next.loadedAt };
  }
}

async function loadGitContext(
  projectId: string,
  options: GitContextRefreshOptions = {},
): Promise<GitContext | undefined> {
  const project = workspaceState.projects.find(
    (candidate) => candidate.id === projectId,
  );
  if (!project) return undefined;
  await refreshGitProject(project, {
    force: options.force,
    silent: true,
    onlyIfChanged: !options.force,
    loadDetails: false,
  });
  applyGitContextFromProject(projectId);
  const context = gitState.gitContext;
  return context?.projectId === projectId ? context : undefined;
}

export async function refreshGitContext(
  projectId?: string,
  options: GitContextRefreshOptions = {},
): Promise<void> {
  const id = projectId ?? workspaceState.selectedProjectId;
  if (!id) return;

  if (options.force) clearPendingRefresh();

  const now = Date.now();
  const elapsed = now - lastRefreshStartedAt;
  if (
    !options.force &&
    lastRefreshStartedAt > 0 &&
    elapsed < GIT_CONTEXT_MIN_REFRESH_MS
  ) {
    scheduleRefresh(id, options, GIT_CONTEXT_MIN_REFRESH_MS - elapsed);
    return;
  }

  if (inFlight.has(id)) {
    if (options.force) scheduleRefresh(id, options, GIT_CONTEXT_MIN_REFRESH_MS);
    return;
  }
  lastRefreshStartedAt = now;
  inFlight.add(id);
  try {
    const next = await loadGitContext(id, options);
    if (next) applyGitContext(next);
  } catch {
    // Discovery failed (not a repo, permissions, etc.) — drop context so no
    // suggestions are shown rather than surfacing an error.
    if (gitState.gitContext?.projectId === id) {
      gitState.gitContext = undefined;
    }
  } finally {
    inFlight.delete(id);
  }
}

export function clearGitContext(): void {
  clearPendingRefresh();
  gitState.gitContext = undefined;
}

/**
 * Coalesce local Git and pull-request refresh demand after a conversation or
 * Git mutation completes.
 */
export function invalidateGit(projectId?: string): void {
  scheduleAutomaticProjectGitRefresh(projectId, {
    overview: true,
    prs: true,
  });
}
