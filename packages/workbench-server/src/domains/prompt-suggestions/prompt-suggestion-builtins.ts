import type {
  PromptSuggestionDefinition,
  PromptSuggestionEvaluationInput,
  PromptSuggestionRepo,
} from "./prompt-suggestion-types.js";

type Input = PromptSuggestionEvaluationInput;
type Repo = PromptSuggestionRepo;

/** Fixed example used to render the Settings prompt preview of each built-in. */
const SAMPLE_REPO: Repo = {
  relativePath: ".",
  absDir: "/path/to/project",
  name: "project",
  worktreeGroup: "/path/to/project/.git",
  primaryWorktree: true,
  isRepo: true,
  currentBranch: "feature/example",
  detached: false,
  ahead: 2,
  behind: 0,
  hasUpstream: true,
  unpublishedCount: null,
  stashCount: 0,
  hasRemote: true,
  hasGithubRemote: true,
  baseBranch: "main",
  onBaseBranch: false,
  mergedToBase: false,
  dirty: true,
  changeCount: 3,
  pullRequest: {
    number: 123,
    url: "https://github.com/example/project/pull/123",
    isDraft: false,
    checks: "failing",
    checksRunning: false,
    reviewRequested: false,
  },
};

function sampleInput(
  repo: Partial<Repo> = {},
  status: "failed" | "idle" = "idle",
): Input {
  return {
    project: { id: "proj_sample", name: "project", dir: "/path/to/project" },
    conversation: {
      id: "conv_sample",
      title: "Sample",
      permissionRuleSetId: "default",
      reasoningLevel: "medium",
      status,
    },
    git: {
      projectIsRepo: true,
      repos: [{ ...SAMPLE_REPO, ...repo }],
      github: { available: true, authenticated: true },
    },
    definitions: [],
  };
}

function githubReady(input: Input): boolean {
  return Boolean(input.git.github?.available && input.git.github.authenticated);
}

function isFeatureBranch(repo: Repo): boolean {
  return !repo.detached && repo.currentBranch !== null && !repo.onBaseBranch;
}

function unpushed(repo: Repo): number {
  return repo.ahead ?? repo.unpublishedCount ?? 0;
}

function canCreatePullRequest(input: Input, repo: Repo): boolean {
  return (
    githubReady(input) &&
    repo.hasRemote &&
    repo.hasGithubRemote &&
    !repo.pullRequest &&
    ((isFeatureBranch(repo) && !repo.mergedToBase) || repo.dirty)
  );
}

function canUpdatePullRequest(repo: Repo): boolean {
  return Boolean(repo.pullRequest) && (repo.dirty || (repo.ahead ?? 0) > 0);
}

function repoSelector(
  select: (input: Input, repo: Repo) => boolean,
): (input: Input) => Repo[] {
  return (input) =>
    uniqueRepos(input.git.repos.filter((r) => select(input, r)));
}

const commitChangesRepos = repoSelector(
  (_input, repo) => repo.dirty && (!repo.onBaseBranch || !repo.hasRemote),
);
const commitOnBranchRepos = repoSelector(
  (_input, repo) => repo.dirty && repo.onBaseBranch && repo.hasRemote,
);
const createPullRequestRepos = repoSelector((input, repo) =>
  canCreatePullRequest(input, repo),
);
const updatePullRequestRepos = repoSelector((_input, repo) =>
  canUpdatePullRequest(repo),
);
const failingChecksRepos = repoSelector(
  (_input, repo) => repo.pullRequest?.checks === "failing",
);
const pushCommitsRepos = repoSelector(
  (input, repo) =>
    !repo.dirty &&
    unpushed(repo) > 0 &&
    !repo.pullRequest &&
    !canCreatePullRequest(input, repo),
);
const pullUpstreamRepos = repoSelector(
  (_input, repo) => (repo.behind ?? 0) > 0,
);
const reviewRepos = repoSelector(
  (_input, repo) => repo.dirty || (isFeatureBranch(repo) && !repo.mergedToBase),
);
const cleanupRepos = repoSelector(
  (_input, repo) =>
    isFeatureBranch(repo) &&
    repo.mergedToBase &&
    repo.hasUpstream &&
    !repo.dirty &&
    !repo.pullRequest,
);

function uniqueRepos(repos: Repo[]): Repo[] {
  const seen = new Set<string>();
  return repos.filter((repo) => {
    if (seen.has(repo.relativePath)) return false;
    seen.add(repo.relativePath);
    return true;
  });
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/** State facts a chip tooltip reports; each suggestion lists only what its task needs. */
type Fact = "changes" | "unpushed" | "behind" | "pr";

/** The project root repo is reported by name; nested repos by their relative path. */
function repoName(repo: Repo): string {
  return repo.relativePath === "." ? repo.name : repo.relativePath;
}

/** Branch first, then the requested non-zero facts. */
function stateParts(repo: Repo, facts: Fact[]): string[] {
  const parts = [
    repo.detached || !repo.currentBranch
      ? "detached HEAD"
      : repo.onBaseBranch
        ? repo.currentBranch
        : `${repo.currentBranch} (base ${repo.baseBranch})`,
  ];
  if (facts.includes("changes") && repo.dirty && repo.changeCount > 0)
    parts.push(plural(repo.changeCount, "uncommitted change"));
  if (facts.includes("unpushed") && unpushed(repo) > 0)
    parts.push(plural(unpushed(repo), "unpushed commit"));
  if (facts.includes("behind") && (repo.behind ?? 0) > 0)
    parts.push(`${plural(repo.behind ?? 0, "commit")} behind upstream`);
  if (facts.includes("pr") && repo.pullRequest)
    parts.push(
      `PR #${repo.pullRequest.number}${repo.pullRequest.isDraft ? " (draft)" : ""}${
        repo.pullRequest.checks === "failing"
          ? repo.pullRequest.checksRunning
            ? ", checks failing (others still running)"
            : ", checks failing"
          : ""
      }`,
    );
  return parts;
}

/** One-line plain-text state for chip tooltips. */
function summarizeRepos(repos: Repo[], facts: Fact[]): string {
  return repos
    .map((repo) =>
      [
        repos.length > 1 || repo.relativePath !== "."
          ? repoName(repo)
          : undefined,
        ...stateParts(repo, facts),
      ]
        .filter(Boolean)
        .join(" · "),
    )
    .join("; ");
}

function codeList(values: string[]): string {
  const quoted = values.map((value) => `\`${value}\``);
  return quoted.length <= 1
    ? quoted.join("")
    : `${quoted.slice(0, -1).join(", ")} and ${quoted.at(-1)}`;
}

/**
 * The request as the user would type it. The agent reads live state itself, so the
 * prompt names only the scope it cannot infer: nested or multiple repositories.
 */
function scoped(request: string, repos: Repo[]): string {
  if (
    repos.length === 0 ||
    (repos.length === 1 && repos[0].relativePath === ".")
  )
    return request;
  return `${request} Do this in ${codeList(repos.map(repoName))}.`;
}

/** The single repo's value, or undefined when several repos apply. */
function single<T>(repos: Repo[], value: (repo: Repo) => T): T | undefined {
  return repos.length === 1 ? value(repos[0]) : undefined;
}

type BuiltinSpec = {
  name: string;
  label: string;
  description: string;
  conditionSummary: string;
  order: number;
  defaultEnabled: boolean;
  repos: (input: Input) => Repo[];
  matches?: (input: Input) => boolean;
  buildLabel?: (input: Input, repos: Repo[]) => string;
  /** State facts shown in the chip tooltip. */
  facts?: Fact[];
  /** The request, phrased as the user asking; scope is appended. */
  request: (repos: Repo[]) => string;
  sample: Input;
};

function definition(spec: BuiltinSpec): PromptSuggestionDefinition {
  const matches = spec.matches ?? ((input) => spec.repos(input).length > 0);
  const facts = spec.facts ?? [];
  const build = (repos: Repo[]) => scoped(spec.request(repos), repos);
  return {
    id: `builtin-${spec.name}`,
    definitionKey: `builtin:${spec.name}`,
    name: spec.name,
    label: spec.label,
    description: spec.description,
    conditionSummary: spec.conditionSummary,
    prompt: spec.label,
    promptPreview: build(spec.repos(spec.sample)),
    buildLabel: spec.buildLabel
      ? (input) => spec.buildLabel!(input, spec.repos(input))
      : undefined,
    buildPrompt: (input) => build(spec.repos(input)),
    buildContext: (input) =>
      summarizeRepos(spec.repos(input), facts) || undefined,
    order: spec.order,
    defaultEnabled: spec.defaultEnabled,
    enabled: spec.defaultEnabled,
    matches,
    source: { kind: "builtin", path: `builtin://${spec.name}` },
  };
}

function sum(repos: Repo[], value: (repo: Repo) => number): number {
  return repos.reduce((total, repo) => total + value(repo), 0);
}

function singlePr(repos: Repo[]): number | undefined {
  return single(repos, (repo) => repo.pullRequest?.number);
}

export function builtinPromptSuggestionDefinitions(): PromptSuggestionDefinition[] {
  return [
    definition({
      name: "commit-changes",
      request: () => "Commit the changes locally.",
      facts: ["changes"],
      label: "Commit changes",
      description:
        "Stages and commits the uncommitted changes with a clear commit message. Nothing is pushed.",
      conditionSummary:
        "Appears when a repository has uncommitted changes on a feature branch, or on its base branch when it has no remote.",
      order: 10,
      defaultEnabled: true,
      repos: commitChangesRepos,
      buildLabel: (_input, repos) => {
        const count = sum(repos, (repo) => repo.changeCount);
        return count > 0
          ? `Commit ${plural(count, "change")}`
          : "Commit changes";
      },
      sample: sampleInput(),
    }),
    definition({
      name: "commit-on-feature-branch",
      request: () => "Commit the changes locally on a new branch.",
      facts: ["changes"],
      label: "Commit on a new branch",
      description:
        "Creates a descriptive feature branch, then commits the changes there instead of on the base branch. Nothing is pushed.",
      conditionSummary:
        "Appears when a repository with a remote has uncommitted changes while on its base branch.",
      order: 20,
      defaultEnabled: true,
      repos: commitOnBranchRepos,
      sample: sampleInput({
        currentBranch: "main",
        onBaseBranch: true,
        mergedToBase: true,
        pullRequest: null,
        ahead: 0,
      }),
    }),
    definition({
      name: "create-pull-request",
      request: (repos) =>
        repos.length > 1
          ? "Create PRs from the changes."
          : "Create a PR from the changes.",
      facts: ["changes", "unpushed"],
      label: "Create a PR",
      description:
        "Commits any pending changes, pushes the branch, and opens a pull request with a concise title and summary. This publishes the branch.",
      conditionSummary:
        "Appears when GitHub CLI is authenticated and a GitHub repository has an unmerged feature branch or uncommitted changes, with no open pull request.",
      order: 30,
      defaultEnabled: true,
      repos: createPullRequestRepos,
      buildLabel: (_input, repos) =>
        repos.length > 1 ? "Create PRs" : "Create a PR",
      sample: sampleInput({ pullRequest: null }),
    }),
    definition({
      name: "update-pull-request",
      request: (repos) => {
        const number = singlePr(repos);
        return number
          ? `Update PR #${number} with the latest changes.`
          : "Update the PRs with the latest changes.";
      },
      facts: ["changes", "unpushed", "pr"],
      label: "Update PR",
      description:
        "Commits pending changes and pushes them to the branch of the open pull request. This publishes commits.",
      conditionSummary:
        "Appears when the current branch has an open pull request and there are uncommitted changes or unpushed commits.",
      order: 40,
      defaultEnabled: true,
      repos: updatePullRequestRepos,
      buildLabel: (_input, repos) => {
        const number = singlePr(repos);
        return number ? `Update PR #${number}` : "Update PRs";
      },
      sample: sampleInput(),
    }),
    definition({
      name: "fix-failing-checks",
      request: (repos) => {
        const number = singlePr(repos);
        return number
          ? `Fix the failing checks on PR #${number}.`
          : "Fix the failing checks on the PRs.";
      },
      facts: ["pr"],
      label: "Fix failing checks",
      description:
        "Inspects the failing CI checks of the open pull request, fixes the cause, then commits and pushes the fix.",
      conditionSummary:
        "Appears when the current branch has an open pull request whose checks are failing.",
      order: 50,
      defaultEnabled: true,
      repos: failingChecksRepos,
      buildLabel: (_input, repos) => {
        const number = singlePr(repos);
        return number
          ? `Fix failing checks (#${number})`
          : "Fix failing checks";
      },
      sample: sampleInput(),
    }),
    definition({
      name: "push-commits",
      request: () => "Push the commits without force-pushing.",
      facts: ["unpushed"],
      label: "Push commits",
      description:
        "Pushes local commits to the remote branch without force-pushing. Appears only when there is no pull request to create or update.",
      conditionSummary:
        "Appears when a clean repository has unpushed commits and no pull request applies, for example outside GitHub or on a base branch.",
      order: 60,
      defaultEnabled: true,
      repos: pushCommitsRepos,
      buildLabel: (_input, repos) =>
        `Push ${plural(sum(repos, unpushed), "commit")}`,
      sample: sampleInput({
        currentBranch: "main",
        onBaseBranch: true,
        dirty: false,
        changeCount: 0,
        pullRequest: null,
      }),
    }),
    definition({
      name: "pull-upstream",
      request: () => "Pull the upstream changes.",
      facts: ["changes", "behind"],
      label: "Pull upstream",
      description:
        "Brings in new upstream commits, keeping uncommitted changes.",
      conditionSummary:
        "Appears when a repository is behind its upstream branch.",
      order: 70,
      defaultEnabled: true,
      repos: pullUpstreamRepos,
      buildLabel: (_input, repos) =>
        `Pull ${plural(
          sum(repos, (repo) => repo.behind ?? 0),
          "commit",
        )}`,
      sample: sampleInput({ behind: 2, dirty: false, changeCount: 0 }),
    }),
    definition({
      name: "review-changes",
      request: (repos) => {
        const base = single(repos, (repo) => repo.baseBranch);
        return `Review the changes against ${base ? `\`${base}\`` : "the base branch"}. Report findings only.`;
      },
      facts: ["changes", "unpushed"],
      label: "Review changes",
      description:
        "Reviews the diff against the base branch and reports findings. It makes no edits.",
      conditionSummary:
        "Appears when a repository has uncommitted changes or an unmerged feature branch. Off by default.",
      order: 80,
      defaultEnabled: false,
      repos: reviewRepos,
      sample: sampleInput(),
    }),
    definition({
      name: "cleanup-merged-branch",
      request: (repos) => {
        const repo = single(repos, (r) => r);
        return repo?.currentBranch
          ? `Delete the merged branch \`${repo.currentBranch}\` and switch to an up-to-date \`${repo.baseBranch}\`.`
          : "Delete the merged branches and switch to up-to-date base branches.";
      },
      facts: [],
      label: "Clean up merged branch",
      description:
        "Switches to the base branch, pulls the latest, and deletes the merged local branch. This removes a local branch.",
      conditionSummary:
        "Appears when a clean feature branch is already merged into its base and has no open pull request. Off by default.",
      order: 90,
      defaultEnabled: false,
      repos: cleanupRepos,
      sample: sampleInput({
        dirty: false,
        changeCount: 0,
        mergedToBase: true,
        ahead: 0,
        pullRequest: null,
      }),
    }),
    definition({
      name: "continue-after-failure",
      label: "Continue",
      description: "Asks the agent to resume the task that was cut short.",
      conditionSummary:
        "Appears when the conversation failed or was interrupted. Off by default.",
      order: 100,
      defaultEnabled: false,
      repos: () => [],
      matches: (input) =>
        input.conversation?.status === "failed" ||
        input.conversation?.status === "interrupted",
      request: () => "Continue.",
      sample: sampleInput({}, "failed"),
    }),
  ];
}
