import { gitState } from "$lib/features/git/state/git-state.svelte";
import type { GitContext } from "$lib/features/state-types";
import { selection } from "$lib/features/workspace/state/selection.svelte";
import { workspaceState } from "$lib/features/workspace/state/workspace-state.svelte";
import {
  gitContextFingerprint,
  shouldRefreshGitContextOnFocus,
} from "./git-context-helpers";
import {
  applyGitContextFromProject,
  invalidateGitPanel,
  refreshGitProject,
} from "./git-panel.svelte";

export {
  gitContextFingerprint,
  shouldRefreshGitContextOnFocus,
} from "./git-context-helpers";
export { buildGitSuggestions, type GitSuggestion } from "./git-suggestions";

const GIT_CONTEXT_AUTO_REFRESH_MS = 10_000;
const GIT_CONTEXT_FOCUS_STALE_MS = 5_000;
const GIT_CONTEXT_MIN_REFRESH_MS = 2_000;

type GitContextRefreshReason = "project" | "invalidate" | "poll" | "focus";

type GitContextRefreshOptions = {
  force?: boolean;
  reason?: GitContextRefreshReason;
};

const inFlight = new Set<string>();
let autoRefreshInterval: number | undefined;
let pendingRefreshTimer: number | undefined;
let lastRefreshStartedAt = 0;

function hiddenForPolling(
  reason: GitContextRefreshReason | undefined,
): boolean {
  return (
    reason === "poll" &&
    typeof document !== "undefined" &&
    document.visibilityState !== "visible"
  );
}

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
  });
  applyGitContextFromProject(projectId);
  const context = gitState.gitContext;
  return context?.projectId === projectId ? context : undefined;
}

export async function refreshGitContext(
  projectId?: string,
  options: GitContextRefreshOptions = {},
): Promise<void> {
  const id = projectId ?? selection.projectId;
  if (!id || hiddenForPolling(options.reason)) return;

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

function refreshIfStale(): void {
  if (
    typeof document !== "undefined" &&
    document.visibilityState !== "visible"
  ) {
    return;
  }

  const projectId = selection.projectId;
  if (
    shouldRefreshGitContextOnFocus(
      gitState.gitContext,
      projectId,
      Date.now(),
      GIT_CONTEXT_FOCUS_STALE_MS,
    )
  ) {
    void refreshGitContext(projectId, {
      reason: "focus",
      force: gitState.gitContext?.projectId !== projectId,
    });
  }
}

export function startGitContextAutoRefresh(): () => void {
  if (typeof window === "undefined") return stopGitContextAutoRefresh;
  if (autoRefreshInterval !== undefined) return stopGitContextAutoRefresh;

  autoRefreshInterval = window.setInterval(() => {
    void refreshGitContext(selection.projectId, { reason: "poll" });
  }, GIT_CONTEXT_AUTO_REFRESH_MS);

  window.addEventListener("focus", refreshIfStale);
  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", refreshIfStale);
  }

  return stopGitContextAutoRefresh;
}

export function stopGitContextAutoRefresh(): void {
  if (typeof window === "undefined") return;
  if (autoRefreshInterval !== undefined) {
    window.clearInterval(autoRefreshInterval);
    autoRefreshInterval = undefined;
  }
  clearPendingRefresh();
  window.removeEventListener("focus", refreshIfStale);
  if (typeof document !== "undefined") {
    document.removeEventListener("visibilitychange", refreshIfStale);
  }
}

/**
 * Bump the refresh token (so the Git tab reloads its overview) and re-pull the
 * lightweight git context used by composer suggestions. Called by any git
 * mutation: GitTab commit/branch/PR/sync, and PR pane checkout.
 */
export function invalidateGit(projectId?: string): void {
  invalidateGitPanel(projectId);
  void refreshGitContext(projectId, { reason: "invalidate", force: true });
}
