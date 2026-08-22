import { invalidateGit as invalidateGitFeature } from "$lib/features/git/state/git-context.svelte";

/** Cross-feature effect used when conversation events can change repository state. */
export function invalidateGit(projectId?: string) {
  return invalidateGitFeature(projectId);
}
