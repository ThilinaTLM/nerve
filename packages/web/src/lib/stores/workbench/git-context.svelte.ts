import { discoverGitRepos, getGithubStatus } from "../../api";
import { selection } from "../../state/app-state.svelte";
import { workbenchState } from "./state.svelte";

export { buildGitSuggestions, type GitSuggestion } from "./git-suggestions";

const inFlight = new Set<string>();

export async function refreshGitContext(projectId?: string): Promise<void> {
  const id = projectId ?? selection.projectId;
  if (!id) return;
  if (inFlight.has(id)) return;
  inFlight.add(id);
  try {
    const discovery = await discoverGitRepos(id);
    let github: { available: boolean; authenticated: boolean } | undefined;
    try {
      const status = await getGithubStatus(
        id,
        discovery.repos[0]?.relativePath ?? ".",
      );
      github = {
        available: status.available,
        authenticated: status.authenticated,
      };
    } catch {
      github = undefined;
    }
    workbenchState.gitContext = {
      projectId: id,
      projectIsRepo: discovery.projectIsRepo,
      repos: discovery.repos,
      github,
      loadedAt: Date.now(),
    };
  } catch {
    // Discovery failed (not a repo, permissions, etc.) — drop context so no
    // suggestions are shown rather than surfacing an error.
    if (workbenchState.gitContext?.projectId === id) {
      workbenchState.gitContext = undefined;
    }
  } finally {
    inFlight.delete(id);
  }
}

export function clearGitContext(): void {
  workbenchState.gitContext = undefined;
}

/**
 * Bump the refresh token (so the Git tab reloads its overview) and re-pull the
 * lightweight git context used by composer suggestions. Called by any git
 * mutation: GitTab commit/branch/PR/sync, and PR pane checkout.
 */
export function invalidateGit(projectId?: string): void {
  workbenchState.gitRefreshToken += 1;
  void refreshGitContext(projectId);
}
