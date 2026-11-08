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

/** State facts a built-in reports; each suggestion lists only what its task needs. */
type Fact = "changes" | "unpushed" | "behind" | "pr";

/** The project root repo is reported by name; nested repos by their relative path. */
function repoName(repo: Repo): string {
  return repo.relativePath === "." ? repo.name : repo.relativePath;
}

/** Branch first, then the requested non-zero facts. `code` wraps refs in backticks. */
function stateParts(repo: Repo, facts: Fact[], code: boolean): string[] {
  const ref = (value: string) => (code ? `\`${value}\`` : value);
  const parts = [
    repo.detached || !repo.currentBranch
      ? "detached HEAD"
      : repo.onBaseBranch
        ? ref(repo.currentBranch)
        : `${ref(repo.currentBranch)} (base ${ref(repo.baseBranch)})`,
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

/** Trailing "Last known state" section: one line for one repo, a list for several. */
function stateSection(repos: Repo[], facts: Fact[]): string[] {
  if (repos.length === 0) return [];
  if (repos.length === 1) {
    const [repo] = repos;
    const scope = repo.relativePath === "." ? "" : ` of \`${repoName(repo)}\``;
    return [
      `Last known state${scope}: ${stateParts(repo, facts, true).join(", ")}.`,
    ];
  }
  return [
    "Last known state:",
    ...repos.map(
      (repo) =>
        `- \`${repoName(repo)}\`: ${stateParts(repo, facts, true).join(", ")}`,
    ),
  ];
}

/** One-line plain-text state for chip tooltips. */
function summarizeRepos(repos: Repo[], facts: Fact[]): string {
  return repos
    .map((repo) =>
      [
        repos.length > 1 || repo.relativePath !== "."
          ? repoName(repo)
          : undefined,
        ...stateParts(repo, facts, false),
      ]
        .filter(Boolean)
        .join(" · "),
    )
    .join("; ");
}

/** Task line, numbered steps, then the last known state at the end. */
function body(
  task: string,
  repos: Repo[],
  facts: Fact[],
  steps: string[],
): string {
  const multi = repos.length > 1;
  return [
    multi
      ? `${task} Do this in each repository listed below, reusing one branch name where a new branch is needed.`
      : task,
    "",
    ...steps.map((step, index) => `${index + 1}. ${step}`),
    ...(repos.length ? ["", ...stateSection(repos, facts)] : []),
  ].join("\n");
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
  /** First line of the prompt, phrased as the user asking. */
  task?: string;
  /** State facts reported in the trailing "Last known state" section. */
  facts?: Fact[];
  steps?: string[];
  /** Custom prompt builder; otherwise built from task, steps and facts. */
  buildPrompt?: (input: Input, repos: Repo[]) => string;
  sample: Input;
};

function definition(spec: BuiltinSpec): PromptSuggestionDefinition {
  const matches = spec.matches ?? ((input) => spec.repos(input).length > 0);
  const facts = spec.facts ?? [];
  const build =
    spec.buildPrompt ??
    ((_input: Input, repos: Repo[]) =>
      body(spec.task ?? spec.label, repos, facts, spec.steps ?? []));
  return {
    id: `builtin-${spec.name}`,
    definitionKey: `builtin:${spec.name}`,
    name: spec.name,
    label: spec.label,
    description: spec.description,
    conditionSummary: spec.conditionSummary,
    prompt: spec.label,
    promptPreview: build(spec.sample, spec.repos(spec.sample)),
    buildLabel: spec.buildLabel
      ? (input) => spec.buildLabel!(input, spec.repos(input))
      : undefined,
    buildPrompt: (input) => build(input, spec.repos(input)),
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
  const numbers = repos.map((repo) => repo.pullRequest?.number);
  return repos.length === 1 ? numbers[0] : undefined;
}

export function builtinPromptSuggestionDefinitions(): PromptSuggestionDefinition[] {
  return [
    definition({
      name: "commit-changes",
      task: "Commit my uncommitted changes.",
      facts: ["changes"],
      label: "Commit changes",
      description:
        "Stages and commits your uncommitted changes with a clear commit message. Nothing is pushed.",
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
      steps: [
        "Review the diff of the uncommitted changes.",
        "Stage the relevant changes and commit them with a clear, conventional commit message that summarizes the diff.",
        "Do not push.",
      ],
      sample: sampleInput(),
    }),
    definition({
      name: "commit-on-feature-branch",
      task: "Commit my changes on a new feature branch.",
      facts: ["changes"],
      label: "Commit on a new branch",
      description:
        "Creates a descriptive feature branch, then commits your changes there instead of on the base branch. Nothing is pushed.",
      conditionSummary:
        "Appears when a repository with a remote has uncommitted changes while on its base branch.",
      order: 20,
      defaultEnabled: true,
      repos: commitOnBranchRepos,
      steps: [
        "Review the diff of the uncommitted changes.",
        "Create a new feature branch with a short, descriptive name.",
        "Stage and commit the changes on that branch with a clear commit message based on the diff.",
        "Do not push.",
      ],
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
      task: "Open a pull request for my current work.",
      facts: ["changes", "unpushed"],
      label: "Create a PR",
      description:
        "Commits any pending changes, pushes the branch to origin, and opens a pull request with a concise title and summary. This publishes your branch.",
      conditionSummary:
        "Appears when GitHub CLI is authenticated and a GitHub repository has an unmerged feature branch or uncommitted changes, with no open pull request.",
      order: 30,
      defaultEnabled: true,
      repos: createPullRequestRepos,
      buildLabel: (_input, repos) =>
        repos.length > 1 ? "Create PRs" : "Create a PR",
      steps: [
        "If on the base branch, create a new feature branch with a descriptive name.",
        "Stage and commit any uncommitted changes with a clear message.",
        "Push the branch to origin, setting upstream if needed.",
        "Create a pull request against the base branch with a concise title and a summary of the changes, then report its URL.",
      ],
      sample: sampleInput({ pullRequest: null }),
    }),
    definition({
      name: "update-pull-request",
      task: "Update my open pull request with the latest work.",
      facts: ["changes", "unpushed", "pr"],
      label: "Update PR",
      description:
        "Commits pending changes and pushes them to the branch of the open pull request, then refreshes the PR description if the scope changed. This publishes commits.",
      conditionSummary:
        "Appears when the current branch has an open pull request and there are uncommitted changes or unpushed commits.",
      order: 40,
      defaultEnabled: true,
      repos: updatePullRequestRepos,
      buildLabel: (_input, repos) => {
        const number = singlePr(repos);
        return number ? `Update PR #${number}` : "Update PRs";
      },
      steps: [
        "Stage and commit any uncommitted changes with a clear message.",
        "Push the branch to origin.",
        "Compare the pull request description with the pushed work and update the title or description if the scope changed.",
        "Report the pull request URL.",
      ],
      sample: sampleInput(),
    }),
    definition({
      name: "fix-failing-checks",
      task: "Fix the failing checks on my pull request.",
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
      steps: [
        "Inspect the failing checks, for example with `gh pr checks` and `gh run view --log-failed`. If other checks are still running, fix what has already failed rather than waiting for them.",
        "Find the root cause and fix it in the code; reproduce locally when practical.",
        "Commit the fix with a clear message and push it to the pull request branch.",
        "Summarize what failed and what you changed.",
      ],
      sample: sampleInput(),
    }),
    definition({
      name: "push-commits",
      task: "Push my unpushed commits.",
      facts: ["unpushed"],
      label: "Push commits",
      description:
        "Pushes your local commits to the remote branch. Appears only when there is no pull request to create or update.",
      conditionSummary:
        "Appears when a clean repository has unpushed commits and no pull request applies, for example outside GitHub or on a base branch.",
      order: 60,
      defaultEnabled: true,
      repos: pushCommitsRepos,
      buildLabel: (_input, repos) =>
        `Push ${plural(sum(repos, unpushed), "commit")}`,
      steps: [
        "Review the unpushed commits.",
        "Push the current branch to its remote, setting upstream if needed.",
        "If the push is rejected, stop and report why instead of forcing it.",
      ],
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
      task: "Bring in the new upstream commits.",
      facts: ["changes", "behind"],
      label: "Pull upstream",
      description:
        "Brings in new upstream commits by pulling or rebasing. It stops and reports if there are conflicts.",
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
      steps: [
        "If there are uncommitted changes, keep them safe (for example stash them) before updating.",
        "Pull or rebase onto the upstream branch.",
        "If conflicts occur, stop and report them instead of resolving them blindly.",
        "Restore anything you stashed and summarize what came in.",
      ],
      sample: sampleInput({ behind: 2, dirty: false, changeCount: 0 }),
    }),
    definition({
      name: "review-changes",
      task: "Review my changes against the base branch.",
      facts: ["changes", "unpushed"],
      label: "Review my changes",
      description:
        "Reads your diff against the base branch and reports risks, bugs, and missing tests. It makes no edits.",
      conditionSummary:
        "Appears when a repository has uncommitted changes or an unmerged feature branch. Off by default.",
      order: 80,
      defaultEnabled: false,
      repos: reviewRepos,
      steps: [
        "Read the diff against the base branch, including uncommitted changes.",
        "Report correctness risks, edge cases, security concerns, and missing tests, ordered by importance.",
        "This is a read-only review: do not edit files, commit, or push.",
      ],
      sample: sampleInput(),
    }),
    definition({
      name: "cleanup-merged-branch",
      task: "Clean up my merged branch.",
      facts: [],
      label: "Clean up merged branch",
      description:
        "Switches to the base branch, pulls the latest, and deletes the merged local branch. This removes a local branch.",
      conditionSummary:
        "Appears when a clean feature branch is already merged into its base and has no open pull request. Off by default.",
      order: 90,
      defaultEnabled: false,
      repos: cleanupRepos,
      steps: [
        "Confirm the branch is fully merged into the base branch and there are no uncommitted changes.",
        "Switch to the base branch and pull the latest changes.",
        "Delete the merged local branch (use a safe delete, not force).",
      ],
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
      description:
        "Asks the agent to re-check the current state and resume the task that was cut short.",
      conditionSummary:
        "Appears when the conversation failed or was interrupted. Off by default.",
      order: 100,
      defaultEnabled: false,
      repos: () => [],
      matches: (input) =>
        input.conversation?.status === "failed" ||
        input.conversation?.status === "interrupted",
      buildPrompt: (input) =>
        [
          "Continue the task from the previous turn; it did not finish.",
          "",
          "1. Re-check what was already done (files, git status, running processes).",
          "2. Resume from where it stopped, without redoing completed work.",
          "3. Summarize what remains if you cannot finish.",
          ...(input.git.repos.length
            ? ["", ...stateSection(input.git.repos, ["changes"])]
            : []),
        ].join("\n"),
      sample: sampleInput({}, "failed"),
    }),
  ];
}
