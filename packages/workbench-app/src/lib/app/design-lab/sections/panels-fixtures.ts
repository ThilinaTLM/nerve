import type {
  GitFileChange,
  GitRepoSummary,
  GithubPr,
  GithubPrHeadsResponse,
} from "@nervekit/contracts/git";
import type { LaunchRecord } from "@nervekit/contracts/launches";
import { enabledCapability } from "$lib/domain/capabilities/feature-capability";
import type {
  ConversationRecord,
  ProjectRecord,
} from "$lib/domain/projects/sidebar-view-models";
import { defaultGitPrFilterConfig } from "$lib/features/git/pr-filters";
import type {
  GitPanelActions,
  GitPanelCapabilities,
  GitPanelModel,
  GitRepoBranchState,
} from "$lib/features/git/views/git-panel-types";
import type {
  LaunchPanelActions,
  LaunchPanelDefinition,
  LaunchPanelModel,
} from "$lib/features/launches/views/launch-panel-types";
import type { ProjectAgentTreeProps } from "$lib/features/projects/views/project-agent-tree-props";
import { summaryActivity } from "$lib/presentation/conversations/conversation-activity";

/** Mock data for the real dock panel views in PanelsSection. */

const noop = () => {};
const now = Date.now();
const minutesAgo = (minutes: number) =>
  new Date(now - minutes * 60_000).toISOString();
const daysAgo = (days: number) => minutesAgo(days * 24 * 60);

const PROJECT_ID = "proj_lab";
const PROJECT_DIR = "/home/dev/nerve";
const GITHUB_REPOSITORY = "acme/nerve";

// ── Conversations ────────────────────────────────────────────────────────

const project: ProjectRecord = {
  id: PROJECT_ID,
  name: "nerve",
  directory: PROJECT_DIR,
  dir: PROJECT_DIR,
  createdAt: daysAgo(90),
  updatedAt: minutesAgo(5),
};

type ConversationSeed = {
  id: string;
  title: string;
  at: string;
  pinned?: boolean;
  status?: ConversationRecord["status"];
  pendingInput?: ConversationRecord["pendingInput"];
  completed?: boolean;
  pr?: number;
  childCount?: number;
};

const conversationSeeds: ConversationSeed[] = [
  {
    id: "conv_pinned_release",
    title: "Release checklist for the next version",
    at: daysAgo(3),
    pinned: true,
  },
  {
    id: "conv_pinned_plan",
    title: "Plan the dock panel density pass",
    at: minutesAgo(40),
    pinned: true,
    status: "waiting",
    pendingInput: {
      conversationId: "conv_pinned_plan",
      conversationTitle: "Plan the dock panel density pass",
      toolCallId: "tool_plan_review",
      kind: "plan_review",
    },
  },
  {
    id: "conv_today_reconnect",
    title: "Investigate the reconnect failure after the daemon restarts",
    at: minutesAgo(4),
    status: "running",
    childCount: 2,
  },
  {
    id: "conv_today_lab",
    title: "Make the Design Lab render the real dock panels",
    at: minutesAgo(25),
    pr: 512,
  },
  {
    id: "conv_today_tokens",
    title: "Audit theme tokens for contrast in light themes",
    at: minutesAgo(70),
  },
  {
    id: "conv_today_checks",
    title: "PR checks are failing, can you fix them",
    at: minutesAgo(130),
    pr: 509,
  },
  {
    id: "conv_today_copy",
    title: "Tighten the empty-state copy",
    at: minutesAgo(150),
    completed: true,
  },
  {
    id: "conv_older_launch",
    title: "Do you see the launch definition ID or the definition?",
    at: daysAgo(12),
  },
  {
    id: "conv_older_backup",
    title: "Do we have daily backups enabled for the production database",
    at: daysAgo(15),
  },
  {
    id: "conv_older_tree",
    title: "Refactor the panel tree keyboard navigation",
    at: daysAgo(18),
    pr: 488,
  },
  {
    id: "conv_older_design",
    title: "Suggest how we can improve this design",
    at: daysAgo(24),
  },
  {
    id: "conv_older_report",
    title: "Report me",
    at: daysAgo(30),
    completed: true,
  },
];

const conversations: ConversationRecord[] = conversationSeeds.map((seed) => ({
  id: seed.id,
  projectId: PROJECT_ID,
  parentConversationId: null,
  parentToolCallId: null,
  title: seed.title,
  status: seed.status ?? "idle",
  statusClearedAt: null,
  paused: false,
  pinnedAt: seed.pinned ? seed.at : null,
  completedAt: seed.completed ? seed.at : null,
  lastUserMessageAt: seed.at,
  createdAt: seed.at,
  updatedAt: seed.at,
  references: seed.pr
    ? [
        {
          provider: "github",
          resourceKey: `github.com/${GITHUB_REPOSITORY}#${seed.pr}`,
          kind: "pull_request",
          relationship: "created",
          url: `https://github.com/${GITHUB_REPOSITORY}/pull/${seed.pr}`,
          container: GITHUB_REPOSITORY,
          identifier: String(seed.pr),
        },
      ]
    : [],
  childCount: seed.childCount ?? 0,
  pendingWork: false,
  pendingInput: seed.pendingInput ?? null,
  agentProfile: "coding",
  permissionRuleSetId: "auto",
  pinned: Boolean(seed.pinned),
  activeAgentId: `agent_${seed.id}`,
}));

export const navigatorSelectedConversationId = "conv_today_lab";

export const conversationNavigatorProps = {
  projects: [project],
  conversations,
  agents: [],
  currentRepositories: { [PROJECT_ID]: `github.com/${GITHUB_REPOSITORY}` },
  homeDir: "/home/dev",
  selectedProjectId: PROJECT_ID,
  openConversationTabIds: new Set([
    navigatorSelectedConversationId,
    "conv_today_reconnect",
    "conv_pinned_plan",
  ]),
  conversationActivityById: Object.fromEntries(
    conversations.map((conversation) => [
      conversation.id,
      summaryActivity(conversation),
    ]),
  ),
  onNewConversationInProject: noop,
  onOpenProjectSettings: noop,
  onDeleteProject: noop,
  onDeleteConversation: noop,
  onUpdateConversationState: noop,
  onPruneProjectConversations: noop,
} satisfies ProjectAgentTreeProps;

// ── Git ──────────────────────────────────────────────────────────────────

function repo(
  summary: Pick<GitRepoSummary, "relativePath" | "name" | "currentBranch"> &
    Partial<GitRepoSummary>,
): GitRepoSummary {
  return {
    absDir:
      summary.relativePath === "."
        ? PROJECT_DIR
        : `${PROJECT_DIR}/${summary.relativePath}`,
    isRepo: true,
    detached: false,
    ahead: 0,
    behind: 0,
    hasUpstream: true,
    hasRemote: true,
    hasGithubRemote: true,
    baseBranch: "main",
    onBaseBranch: summary.currentBranch === "main",
    mergedToBase: summary.currentBranch === "main",
    dirty: false,
    changeCount: 0,
    ...summary,
  };
}

const repositories: GitRepoSummary[] = [
  repo({
    relativePath: ".",
    name: "nerve",
    currentBranch: "main",
    behind: 2,
    dirty: true,
    changeCount: 4,
  }),
  repo({
    relativePath: "packages/ui-kit",
    name: "ui-kit",
    currentBranch: "feat/panel-density",
    ahead: 1,
  }),
  repo({ relativePath: "docs", name: "docs", currentBranch: "main" }),
];
const [rootRepo, uiKitRepo] = repositories as [GitRepoSummary, GitRepoSummary];

const changedFiles: GitFileChange[] = [
  {
    path: "packages/workbench-app/src/lib/app/design-lab/sections/panels-fixtures.ts",
    index: "A",
    worktree: " ",
    staged: true,
    untracked: false,
  },
  {
    path: "packages/workbench-app/src/lib/app/design-lab/sections/PanelsSection.svelte",
    index: "M",
    worktree: " ",
    staged: true,
    untracked: false,
  },
  {
    path: "packages/ui-kit/src/styles/app.css",
    index: " ",
    worktree: "M",
    staged: false,
    untracked: false,
  },
  {
    path: "docs/design-lab.md",
    index: "?",
    worktree: "?",
    staged: false,
    untracked: true,
  },
];

function pr(
  fields: Pick<GithubPr, "number" | "title" | "headRefName" | "author"> &
    Partial<GithubPr>,
): GithubPr {
  return {
    url: `https://github.com/acme/ui-kit/pull/${fields.number}`,
    state: "OPEN",
    isDraft: false,
    baseRefName: "main",
    updatedAt: minutesAgo(30),
    commentCount: 0,
    additions: 120,
    deletions: 40,
    headSha: `${fields.number}abcdef0123456789`,
    headRepository: "acme/ui-kit",
    labels: [],
    reviewRequested: false,
    checks: {
      status: "passing",
      total: 6,
      passed: 6,
      failed: 0,
      pending: 0,
      runs: [],
    },
    ...fields,
  };
}

const pullRequests: GithubPr[] = [
  pr({
    number: 214,
    title: "Tighten dock panel row density",
    headRefName: "feat/panel-density",
    author: "octocat",
    commentCount: 3,
    additions: 248,
    deletions: 96,
    updatedAt: minutesAgo(12),
    checks: {
      status: "pending",
      total: 6,
      passed: 4,
      failed: 0,
      pending: 2,
      runs: [],
    },
  }),
  pr({
    number: 211,
    title: "Add the success and warning tones to Badge",
    headRefName: "feat/badge-tones",
    author: "hubot",
    reviewRequested: true,
    labels: ["design-system"],
    updatedAt: minutesAgo(140),
  }),
  pr({
    number: 207,
    title: "Fix focus ring clipping in scroll regions",
    headRefName: "fix/scroll-focus-ring",
    author: "monalisa",
    isDraft: true,
    additions: 18,
    deletions: 6,
    updatedAt: daysAgo(2),
    checks: {
      status: "failing",
      total: 6,
      passed: 5,
      failed: 1,
      pending: 0,
      runs: [],
    },
  }),
];

const prHeads: GithubPrHeadsResponse = {
  repository: "acme/ui-kit",
  prs: pullRequests.map((entry) => ({
    number: entry.number,
    url: entry.url,
    headRefName: entry.headRefName,
    headRepository: entry.headRepository,
    isDraft: entry.isDraft,
    updatedAt: entry.updatedAt,
  })),
};

const gitCapabilities: GitPanelCapabilities = {
  refresh: enabledCapability,
  selectRepository: enabledCapability,
  branches: enabledCapability,
  mutateFiles: enabledCapability,
  bulkMutateFiles: enabledCapability,
  stashes: enabledCapability,
  remote: {
    fetch: enabledCapability,
    pull: enabledCapability,
    push: enabledCapability,
    sync: enabledCapability,
    "switch-base-and-pull": enabledCapability,
  },
  openPullRequest: enabledCapability,
};

function repoBranchState(repository: string): GitRepoBranchState {
  const summary = repositories.find(
    (entry) => entry.relativePath === repository,
  );
  return {
    repositoryUrl: `https://github.com/acme/${summary?.name ?? "nerve"}`,
    repoSummary: summary,
    branches: [],
    prHeads:
      repository === uiKitRepo.relativePath
        ? prHeads
        : { repository: `acme/${summary?.name ?? "nerve"}`, prs: [] },
    loadingBranches: false,
    loadingPrHeads: false,
  };
}

const gitModelBase = {
  availability: { available: true },
  repositories,
  branches: [],
  collapsedChangeTreeFolders: new Set<string>(),
  stashes: [],
  github: { available: true, authenticated: true, login: "octocat" },
  pullRequestFilters: defaultGitPrFilterConfig,
  initialLoading: false,
  refreshing: false,
  loadingOverview: false,
  loadingBranches: false,
  loadingPullRequests: false,
  loadingPrHeads: false,
  operations: {
    fetching: false,
    pulling: false,
    pushing: false,
    syncing: false,
    switchingBaseAndPulling: false,
    creatingBranch: false,
  },
  capabilities: gitCapabilities,
  repoBranchState,
} satisfies Partial<GitPanelModel>;

/** Git changes: the root repository on `main` with staged and unstaged files. */
export const gitChangesModel: GitPanelModel = {
  ...gitModelBase,
  selectedRepository: rootRepo.relativePath,
  repositorySummary: rootRepo,
  changes: {
    files: changedFiles,
    stagedCount: 2,
    unstagedCount: 1,
    untrackedCount: 1,
  },
  pullRequests: [],
};

/** Pull requests: the ui-kit repository, whose branch has PR #214 checked out. */
export const pullRequestsModel: GitPanelModel = {
  ...gitModelBase,
  selectedRepository: uiKitRepo.relativePath,
  repositorySummary: uiKitRepo,
  pullRequests,
  prHeads,
};

export const gitActions: GitPanelActions = {
  runBulkRemoteOperation: noop,
  refreshAll: noop,
  refreshRepository: noop,
  loadStashes: async () => [],
  refreshBranches: noop,
  loadPullRequestBadges: noop,
  refreshPullRequests: noop,
  configurePullRequests: noop,
  resetPullRequestConfig: noop,
  selectRepository: noop,
  createBranch: noop,
  switchBranch: noop,
  deleteBranch: noop,
  openDiff: noop,
  mutateFile: noop,
  mutateFileScope: noop,
  createStash: noop,
  setChangeTreeFolderExpanded: noop,
  applyStash: noop,
  dropStash: noop,
  runRemoteOperation: noop,
  selectPullRequest: noop,
  openPullRequest: noop,
};

// ── Launches ─────────────────────────────────────────────────────────────

const launchDefinitions: LaunchPanelDefinition[] = [
  {
    id: "launchdef_workbench_ui",
    scope: { kind: "project", projectId: PROJECT_ID },
    parentFolderId: "launchfolder_dev",
    order: 0,
    label: "workbench-ui",
    command: "pnpm dev:ui",
    port: 5173,
    createdAt: daysAgo(20),
    updatedAt: daysAgo(20),
    runPolicy: "single",
  },
  {
    id: "launchdef_website",
    scope: { kind: "project", projectId: PROJECT_ID },
    parentFolderId: "launchfolder_dev",
    order: 1,
    label: "website-dev",
    command: "pnpm --filter website dev",
    port: 4321,
    createdAt: daysAgo(20),
    updatedAt: daysAgo(20),
    runPolicy: "single",
  },
];

const runningLaunch: LaunchRecord = {
  id: "launch_workbench_ui",
  definitionId: "launchdef_workbench_ui",
  name: "workbench-ui",
  projectId: PROJECT_ID,
  cwd: PROJECT_DIR,
  command: "pnpm dev:ui",
  status: "ready",
  readiness: { outcome: "ready", readyAt: minutesAgo(30) },
  stdoutPath: "/tmp/launch_workbench_ui/stdout.log",
  stderrPath: "/tmp/launch_workbench_ui/stderr.log",
  logsPath: "/tmp/launch_workbench_ui",
  startedAt: minutesAgo(31),
  updatedAt: minutesAgo(30),
  visibility: "background",
};

export const launchPanelModel: LaunchPanelModel = {
  projectId: PROJECT_ID,
  folders: [
    {
      id: "launchfolder_dev",
      label: "Dev servers",
      parentFolderId: null,
      order: 0,
    },
  ],
  catalogRevision: "rev-lab",
  availability: { available: true },
  launches: [runningLaunch],
  logsLoading: false,
  definitions: launchDefinitions,
  defaultCwd: PROJECT_DIR,
  definitionsLoading: false,
  capabilities: {
    start: enabledCapability,
    cancel: enabledCapability,
    restart: enabledCapability,
    remove: enabledCapability,
    prune: enabledCapability,
    copy: enabledCapability,
    logs: enabledCapability,
    manageDefinitions: enabledCapability,
  },
};

export const launchPanelActions: LaunchPanelActions = {
  refreshDefinitions: noop,
  createFolder: noop,
  renameFolder: noop,
  deleteFolder: noop,
  moveEntry: noop,
  selectLaunch: noop,
  openLaunchOutput: noop,
  startLaunch: noop,
  runDefinition: noop,
  confirmPortConflict: noop,
  dismissPortConflict: noop,
  cancelLaunch: noop,
  forceKillLaunch: noop,
  restartLaunch: noop,
  removeLaunch: noop,
  cleanupRuns: noop,
  pruneLaunches: noop,
  copyText: noop,
  createDefinition: noop,
  updateDefinition: noop,
  deleteDefinition: noop,
  loadLogs: noop,
};
