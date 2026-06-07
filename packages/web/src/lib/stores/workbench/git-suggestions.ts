import type { GitRepoSummary } from "../../api";
import type { GitContext } from "./state.svelte";

export type GitSuggestion = {
  id: "commit" | "commit-branch" | "open-pr" | "push";
  label: string;
  prompt: string;
};

function scope(set: GitRepoSummary[]): string {
  return set.length > 1
    ? ` for these repositories: ${set.map((r) => r.relativePath).join(", ")}`
    : "";
}

function uniqueRepos(repos: GitRepoSummary[]): GitRepoSummary[] {
  const seen = new Set<string>();
  const result: GitRepoSummary[] = [];
  for (const repo of repos) {
    if (seen.has(repo.relativePath)) continue;
    seen.add(repo.relativePath);
    result.push(repo);
  }
  return result;
}

/**
 * Pure derivation of composer follow-up git suggestions from the current git
 * context. Each suggestion computes its own repo set, plural/scope language and
 * prompt; there is no single global "multi" flag.
 */
export function buildGitSuggestions(ctx: GitContext): GitSuggestion[] {
  const repos = ctx.repos;
  const changed = repos.filter((r) => r.dirty);
  const unpushed = repos.filter((r) => !r.dirty && (r.ahead ?? 0) > 0);
  const onBaseChanged = changed.filter((r) => r.onBaseBranch);
  const prRepos = uniqueRepos([...changed, ...unpushed]);
  const ghReady = Boolean(ctx.github?.available && ctx.github?.authenticated);

  const suggestions: GitSuggestion[] = [];

  if (changed.length > 0) {
    suggestions.push({
      id: "commit",
      label: "Commit changes",
      prompt:
        changed.length > 1
          ? `For each repository with uncommitted changes, stage and commit its changes with a clear, conventional commit message derived from that repo's own diff${scope(changed)}.`
          : "Stage and commit the current changes with a clear, conventional commit message summarizing what changed.",
    });
  }

  if (onBaseChanged.length > 0) {
    suggestions.push({
      id: "commit-branch",
      label: "Commit on a feature branch",
      prompt:
        onBaseChanged.length > 1
          ? `Create a feature branch (reuse one descriptive branch name across repos) and commit the changes in each repository currently on its base branch${scope(onBaseChanged)}. Use a clear commit message per repo based on its diff.`
          : "Create a new feature branch with a descriptive name, then stage and commit the current changes to it with a clear commit message.",
    });
  }

  if (ghReady && prRepos.length > 0) {
    const steps =
      "Open a pull request for the current work:\n" +
      "1. If on the base branch, create a new feature branch.\n" +
      "2. Stage and commit any uncommitted changes with a clear message.\n" +
      "3. Push the branch to origin (set upstream if needed).\n" +
      "4. Create a pull request with a concise title and a summary of the changes.";
    const suffix =
      prRepos.length > 1
        ? ` Do this for each of these repositories, reusing a shared feature branch name where it makes sense: ${prRepos
            .map((r) => r.relativePath)
            .join(", ")}.`
        : "";
    suggestions.push({
      id: "open-pr",
      label: prRepos.length > 1 ? "Create PRs" : "Create a PR",
      prompt: `${steps}${suffix}`,
    });
  }

  if (unpushed.length > 0 && changed.length === 0) {
    suggestions.push({
      id: "push",
      label: "Push changes",
      prompt:
        unpushed.length > 1
          ? `Push the committed changes to origin for each repository with unpushed commits${scope(unpushed)}.`
          : "Push the committed changes on the current branch to origin (set upstream if needed).",
    });
  }

  return suggestions;
}
