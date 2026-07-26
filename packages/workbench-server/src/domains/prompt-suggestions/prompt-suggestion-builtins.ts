import type { GitRepoSummary } from "@nervekit/contracts";
import type {
  PromptSuggestionDefinition,
  PromptSuggestionEvaluationInput,
} from "./prompt-suggestion-types.js";

function scope(repos: GitRepoSummary[]): string {
  return repos.length > 1
    ? ` for these repositories: ${repos.map((repo) => repo.relativePath).join(", ")}`
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
  return repos.filter((repo) => {
    if (seen.has(repo.relativePath)) return false;
    seen.add(repo.relativePath);
    return true;
  });
}

function definition(
  name: string,
  label: string,
  description: string,
  order: number,
  matches: (input: PromptSuggestionEvaluationInput) => boolean,
  buildPrompt: (input: PromptSuggestionEvaluationInput) => string,
  buildLabel?: (input: PromptSuggestionEvaluationInput) => string,
): PromptSuggestionDefinition {
  return {
    id: `builtin-${name}`,
    definitionKey: `builtin:${name}`,
    name,
    label,
    description,
    prompt: label,
    buildLabel,
    buildPrompt,
    order,
    defaultEnabled: true,
    enabled: true,
    matches,
    source: { kind: "builtin", path: `builtin://${name}` },
  };
}

export function builtinPromptSuggestionDefinitions(): PromptSuggestionDefinition[] {
  return [
    definition(
      "commit-changes",
      "Commit changes",
      "Stage and commit uncommitted changes with a clear commit message.",
      10,
      (input) => input.git.repos.some((repo) => repo.dirty),
      (input) => {
        const changed = input.git.repos.filter((repo) => repo.dirty);
        return (
          gitStatusBlock(changed) +
          (changed.length > 1
            ? `For each repository with uncommitted changes, stage and commit its changes with a clear, conventional commit message derived from that repo's own diff${scope(changed)}.`
            : "Stage and commit the current changes with a clear, conventional commit message summarizing what changed.")
        );
      },
    ),
    definition(
      "commit-on-feature-branch",
      "Commit on a feature branch",
      "Create a feature branch before committing changes on a base branch.",
      20,
      (input) =>
        input.git.repos.some((repo) => repo.dirty && repo.onBaseBranch),
      (input) => {
        const changed = input.git.repos.filter(
          (repo) => repo.dirty && repo.onBaseBranch,
        );
        return (
          gitStatusBlock(changed) +
          (changed.length > 1
            ? `Create a feature branch (reuse one descriptive branch name across repos) and commit the changes in each repository currently on its base branch${scope(changed)}. Use a clear commit message per repo based on its diff.`
            : "Create a new feature branch with a descriptive name, then stage and commit the current changes to it with a clear commit message.")
        );
      },
    ),
    definition(
      "create-pull-request",
      "Create a PR",
      "Commit and push the current work, then create a pull request.",
      30,
      (input) =>
        githubReady(input) && pullRequestRepos(input.git.repos).length > 0,
      (input) => {
        const repos = pullRequestRepos(input.git.repos);
        const steps =
          "Open a pull request for the current work:\n" +
          "1. If on the base branch, create a new feature branch.\n" +
          "2. Stage and commit any uncommitted changes with a clear message.\n" +
          "3. Push the branch to origin (set upstream if needed).\n" +
          "4. Create a pull request with a concise title and a summary of the changes.";
        const suffix =
          repos.length > 1
            ? ` Do this for each of these repositories, reusing a shared feature branch name where it makes sense: ${repos
                .map((repo) => repo.relativePath)
                .join(", ")}.`
            : "";
        return `${gitStatusBlock(repos)}${steps}${suffix}`;
      },
      (input) =>
        pullRequestRepos(input.git.repos).length > 1
          ? "Create PRs"
          : "Create a PR",
    ),
  ];
}

function githubReady(input: PromptSuggestionEvaluationInput): boolean {
  return Boolean(input.git.github?.available && input.git.github.authenticated);
}

function pullRequestRepos(repos: GitRepoSummary[]): GitRepoSummary[] {
  const githubRepos = repos.filter(
    (repo) => repo.hasRemote && repo.hasGithubRemote,
  );
  const changed = githubRepos.filter((repo) => repo.dirty);
  const featureBranches = githubRepos.filter(
    (repo) =>
      !repo.detached &&
      repo.currentBranch !== null &&
      !repo.onBaseBranch &&
      !repo.mergedToBase,
  );
  return uniqueRepos([...changed, ...featureBranches]);
}
