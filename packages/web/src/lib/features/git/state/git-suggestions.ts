import type { GitRepoSummary } from "$lib/api";
import type { GitContext } from "$lib/core/types/state-types";

export type GitSuggestion = {
  id: "commit" | "commit-branch" | "open-pr";
  label: string;
  prompt: string;
};

function scope(set: GitRepoSummary[]): string {
  return set.length > 1
    ? ` for these repositories: ${set.map((r) => r.relativePath).join(", ")}`
    : "";
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function gitStatusCommandFor(repo: GitRepoSummary): string {
  return repo.relativePath === "."
    ? "git status --short --branch"
    : `git -C ${shellQuote(repo.relativePath)} status --short --branch`;
}

function gitStatusBlock(repos: GitRepoSummary[]): string {
  const unique = uniqueRepos(repos);
  const command =
    unique.length === 1
      ? gitStatusCommandFor(unique[0])
      : unique
          .map(
            (repo) =>
              `printf '\\n## %s\\n' ${shellQuote(repo.relativePath)}\n${gitStatusCommandFor(repo)}`,
          )
          .join("\n");
  return `\`\`\`!!!\n${command}\n\`\`\`\n\n`;
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
  const onBaseChanged = changed.filter((r) => r.onBaseBranch);
  const githubRemoteRepos = repos.filter(
    (r) => r.hasRemote && r.hasGithubRemote,
  );
  const changedGithubRepos = changed.filter(
    (r) => r.hasRemote && r.hasGithubRemote,
  );
  const prBranchRepos = githubRemoteRepos.filter(
    (r) =>
      !r.detached &&
      r.currentBranch !== null &&
      !r.onBaseBranch &&
      !r.mergedToBase,
  );
  const prRepos = uniqueRepos([...changedGithubRepos, ...prBranchRepos]);
  const ghReady = Boolean(ctx.github?.available && ctx.github?.authenticated);

  const suggestions: GitSuggestion[] = [];

  if (changed.length > 0) {
    suggestions.push({
      id: "commit",
      label: "Commit changes",
      prompt:
        gitStatusBlock(changed) +
        (changed.length > 1
          ? `For each repository with uncommitted changes, stage and commit its changes with a clear, conventional commit message derived from that repo's own diff${scope(changed)}.`
          : "Stage and commit the current changes with a clear, conventional commit message summarizing what changed."),
    });
  }

  if (onBaseChanged.length > 0) {
    suggestions.push({
      id: "commit-branch",
      label: "Commit on a feature branch",
      prompt:
        gitStatusBlock(onBaseChanged) +
        (onBaseChanged.length > 1
          ? `Create a feature branch (reuse one descriptive branch name across repos) and commit the changes in each repository currently on its base branch${scope(onBaseChanged)}. Use a clear commit message per repo based on its diff.`
          : "Create a new feature branch with a descriptive name, then stage and commit the current changes to it with a clear commit message."),
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
      prompt: `${gitStatusBlock(prRepos)}${steps}${suffix}`,
    });
  }

  return suggestions;
}
