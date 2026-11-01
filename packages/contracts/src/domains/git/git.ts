import { z } from "zod";

/**
 * Transport-neutral schemas for the Git utility panel (basic git workflow +
 * GitHub via `gh` + multi-repo discovery). Execution lives in the
 * orchestrator; these types describe the request/response payloads only.
 */

export const gitStatusCodeSchema = z.enum([
  "M",
  "A",
  "D",
  "R",
  "C",
  "U",
  "?",
  "!",
  " ",
]);
export type GitStatusCode = z.infer<typeof gitStatusCodeSchema>;

export const gitRepoSummarySchema = z.object({
  /** Path relative to the project dir; "." when the project dir is a repo. */
  relativePath: z.string(),
  /** Absolute path to the repository working tree. */
  absDir: z.string(),
  /** Display name (basename of the repo dir, or project name for "."). */
  name: z.string(),
  isRepo: z.literal(true),
  /** Current branch, or null when HEAD is detached. */
  currentBranch: z.string().nullable(),
  detached: z.boolean(),
  /** Commits ahead of upstream; null when there is no upstream. */
  ahead: z.number().int().nullable(),
  /** Commits behind upstream; null when there is no upstream. */
  behind: z.number().int().nullable(),
  hasUpstream: z.boolean(),
  /** True when at least one remote is configured (`git remote`). */
  hasRemote: z.boolean(),
  /**
   * True when at least one configured remote points at GitHub. This is a
   * frontend-safe provider hint only; remote URLs stay in the orchestrator.
   */
  hasGithubRemote: z.boolean(),
  /** Detected base branch (origin/HEAD, else main/master/develop). */
  baseBranch: z.string(),
  /** True when the current branch is the detected base branch. */
  onBaseBranch: z.boolean(),
  /** True when current HEAD is already reachable from the detected base branch. */
  mergedToBase: z.boolean(),
  dirty: z.boolean(),
  changeCount: z.number().int().nonnegative(),
});
export type GitRepoSummary = z.infer<typeof gitRepoSummarySchema>;

export const gitRepositoryMonitorSyncRequestSchema = z.object({
  projectId: z.string().startsWith("proj_"),
  repo: z.string().min(1).max(1_024),
  active: z.boolean(),
});
export type GitRepositoryMonitorSyncRequest = z.infer<
  typeof gitRepositoryMonitorSyncRequestSchema
>;

export const gitRepositoryMonitorClearRequestSchema = z.object({
  projectId: z.string().startsWith("proj_"),
  repo: z.string().min(1).max(1_024),
});

export const gitRepositoryMonitorStateSchema = z.object({
  active: z.boolean(),
  degraded: z.boolean(),
});

export const gitRepositoryRefreshResponseSchema = z.object({
  /** False when no live client is monitoring this scope; nothing was refreshed. */
  active: z.boolean(),
  /** Monitor generation after the refresh; 0 when inactive. */
  generation: z.number().int().nonnegative(),
});

export const gitProjectReadErrorSchema = z.object({
  repo: z.string(),
  category: z.string(),
  message: z.string(),
  retryable: z.boolean(),
});
export type GitProjectReadError = z.infer<typeof gitProjectReadErrorSchema>;
export const gitDiscoveryResponseSchema = z.object({
  /** Read completed across an uncertain poll; a deferred revalidation may still be needed. */
  stale: z.boolean().optional(),
  projectIsRepo: z.boolean(),
  repos: z.array(gitRepoSummarySchema),
  errors: z.array(gitProjectReadErrorSchema).optional(),
});
export type GitDiscoveryResponse = z.infer<typeof gitDiscoveryResponseSchema>;

export const gitFileChangeSchema = z.object({
  path: z.string(),
  renamedFrom: z.string().optional(),
  index: gitStatusCodeSchema,
  worktree: gitStatusCodeSchema,
  staged: z.boolean(),
  untracked: z.boolean(),
});
export type GitFileChange = z.infer<typeof gitFileChangeSchema>;

export const gitProjectFileStatusSchema = gitFileChangeSchema.extend({
  /** Repository path relative to the project; `.` for a root repository. */
  repo: z.string(),
  /** File path relative to the project root. */
  path: z.string(),
  /** Previous path relative to the project root for renames. */
  renamedFrom: z.string().optional(),
});
export type GitProjectFileStatus = z.infer<typeof gitProjectFileStatusSchema>;

export const gitProjectFileStatusResponseSchema = z.object({
  stale: z.boolean().optional(),
  files: z.array(gitProjectFileStatusSchema),
  errors: z.array(gitProjectReadErrorSchema).optional(),
});
export type GitProjectFileStatusResponse = z.infer<
  typeof gitProjectFileStatusResponseSchema
>;

export const gitRecentCommitSchema = z.object({
  hash: z.string(),
  subject: z.string(),
  relativeDate: z.string(),
});
export type GitRecentCommit = z.infer<typeof gitRecentCommitSchema>;

export const gitStashEntrySchema = z.object({
  index: z.number().int().nonnegative(),
  ref: z.string().regex(/^stash@\{\d+\}$/),
  hash: z.string().min(7).max(128),
  message: z.string(),
  relativeDate: z.string(),
});
export type GitStashEntry = z.infer<typeof gitStashEntrySchema>;

export const gitOverviewResponseSchema = z.object({
  stale: z.boolean().optional(),
  repo: gitRepoSummarySchema,
  baseBranch: z.string(),
  onBaseBranch: z.boolean(),
  files: z.array(gitFileChangeSchema),
  stagedCount: z.number().int().nonnegative(),
  unstagedCount: z.number().int().nonnegative(),
  untrackedCount: z.number().int().nonnegative(),
  insertions: z.number().int().nonnegative(),
  deletions: z.number().int().nonnegative(),
  recentCommits: z.array(gitRecentCommitSchema),
  stashes: z.array(gitStashEntrySchema),
});
export type GitOverviewResponse = z.infer<typeof gitOverviewResponseSchema>;

export const gitBranchSummarySchema = z.object({
  /** Branch display/ref name, e.g. `main` or `origin/main`. */
  name: z.string(),
  current: z.boolean(),
  remote: z.boolean(),
  upstream: z.string().nullable(),
  /** Commit time of the branch tip, when the object is available locally. */
  updatedAt: z.string().datetime().nullable(),
});
export type GitBranchSummary = z.infer<typeof gitBranchSummarySchema>;

export const gitBranchListResponseSchema = z.object({
  branches: z.array(gitBranchSummarySchema),
});
export type GitBranchListResponse = z.infer<typeof gitBranchListResponseSchema>;

// --- Request payloads ---

export const createBranchRequestSchema = z.object({
  repo: z.string().default("."),
  name: z.string().min(1),
});
export type CreateBranchRequest = z.infer<typeof createBranchRequestSchema>;

export const switchBranchRequestSchema = z.object({
  repo: z.string().default("."),
  name: z.string().min(1),
});
export type SwitchBranchRequest = z.infer<typeof switchBranchRequestSchema>;

export const deleteBranchRequestSchema = z.object({
  repo: z.string().default("."),
  name: z.string().min(1),
});
export type DeleteBranchRequest = z.infer<typeof deleteBranchRequestSchema>;

/** Repository scope reused by GitHub request schemas; not a synchronous mutation RPC. */
export const gitRemoteOpRequestSchema = z.object({
  repo: z.string().default("."),
});
export type GitRemoteOpRequest = z.infer<typeof gitRemoteOpRequestSchema>;

export const gitFileActionRequestSchema = z.object({
  repo: z.string().default("."),
  path: z.string().min(1),
});
export type GitFileActionRequest = z.infer<typeof gitFileActionRequestSchema>;

export const gitStashAreaSchema = z.enum(["staged", "unstaged"]);
export type GitStashArea = z.infer<typeof gitStashAreaSchema>;

export const gitStashCreateRequestSchema = z.object({
  repo: z.string().default("."),
  area: gitStashAreaSchema,
  paths: z.array(z.string().min(1)).max(10_000).optional(),
});
export type GitStashCreateRequest = z.infer<typeof gitStashCreateRequestSchema>;

export const gitStashTargetRequestSchema = z.object({
  repo: z.string().default("."),
  index: z.number().int().nonnegative(),
  expectedHash: z.string().min(7).max(128),
});
export type GitStashTargetRequest = z.infer<typeof gitStashTargetRequestSchema>;

export const gitDiffAreaSchema = z.enum(["staged", "unstaged"]);
export type GitDiffArea = z.infer<typeof gitDiffAreaSchema>;

export const gitFileDiffRequestSchema = gitFileActionRequestSchema.extend({
  area: gitDiffAreaSchema,
});
export type GitFileDiffRequest = z.infer<typeof gitFileDiffRequestSchema>;

const gitFileDiffMetadataSchema = z.object({
  path: z.string(),
  renamedFrom: z.string().optional(),
  area: gitDiffAreaSchema,
});

export const gitFileDiffResponseSchema = z.discriminatedUnion("binary", [
  gitFileDiffMetadataSchema.extend({
    binary: z.literal(false),
    original: z.string(),
    modified: z.string(),
  }),
  gitFileDiffMetadataSchema.extend({
    binary: z.literal(true),
  }),
]);
export type GitFileDiffResponse = z.infer<typeof gitFileDiffResponseSchema>;

export const gitMutationResponseSchema = z.object({
  repo: gitRepoSummarySchema,
});
export type GitMutationResponse = z.infer<typeof gitMutationResponseSchema>;

// --- GitHub (gh) ---

export const githubStatusResponseSchema = z.object({
  available: z.boolean(),
  authenticated: z.boolean(),
  login: z.string().nullable(),
  reason: z.string().optional(),
});
export type GithubStatusResponse = z.infer<typeof githubStatusResponseSchema>;

export const githubCheckRunSchema = z.object({
  name: z.string(),
  status: z.string(),
  conclusion: z.string().nullable(),
  url: z.string().optional(),
  /** Workflow (Actions) or app name, for grouping and secondary text. */
  workflow: z.string().optional(),
  /** First failure line (check-run `output.title`). */
  summary: z.string().max(500).optional(),
  required: z.boolean().optional(),
  startedAt: z.string().optional(),
  completedAt: z.string().optional(),
});
export type GithubCheckRun = z.infer<typeof githubCheckRunSchema>;

export const githubChecksSummarySchema = z.object({
  status: z.enum(["pending", "passing", "failing", "none"]),
  total: z.number().int().nonnegative(),
  passed: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  pending: z.number().int().nonnegative(),
  runs: z.array(githubCheckRunSchema),
});
export type GithubChecksSummary = z.infer<typeof githubChecksSummarySchema>;

export const githubPrHeadSummarySchema = z.object({
  number: z.number().int().positive(),
  url: z.string(),
  headRefName: z.string(),
  headRepository: z.string().nullable(),
  isDraft: z.boolean(),
  updatedAt: z.string(),
});
export type GithubPrHeadSummary = z.infer<typeof githubPrHeadSummarySchema>;

export const githubPrHeadsResponseSchema = z.object({
  repository: z.string(),
  prs: z.array(githubPrHeadSummarySchema),
});
export type GithubPrHeadsResponse = z.infer<typeof githubPrHeadsResponseSchema>;

export const githubPrSchema = z.object({
  number: z.number().int(),
  title: z.string(),
  url: z.string(),
  state: z.string(),
  isDraft: z.boolean(),
  headRefName: z.string(),
  baseRefName: z.string(),
  updatedAt: z.string(),
  /* Summary metadata the list rows render directly, so a row never needs the
   * heavier detail payload to show who opened a PR and how large it is. */
  author: z.string().nullable().default(null),
  commentCount: z.number().int().nonnegative().default(0),
  additions: z.number().int().nonnegative().default(0),
  deletions: z.number().int().nonnegative().default(0),
  /** Head commit; checks are probed per head SHA. Empty when unknown. */
  headSha: z.string().max(64).default(""),
  /** `owner/name` of the head repository; null for deleted forks. */
  headRepository: z.string().nullable().default(null),
  labels: z.array(z.string()).default([]),
  /** The signed-in viewer is a requested reviewer. */
  reviewRequested: z.boolean().default(false),
  checks: githubChecksSummarySchema,
});
export type GithubPr = z.infer<typeof githubPrSchema>;

export const githubPrListResponseSchema = z.object({
  prs: z.array(githubPrSchema),
});
export type GithubPrListResponse = z.infer<typeof githubPrListResponseSchema>;

export const githubPrListFiltersSchema = z
  .object({
    author: z.enum(["any", "me", "username"]).default("any"),
    username: z.string().trim().min(1).max(100).optional(),
    /** Only PRs where the signed-in user is a requested reviewer. */
    reviewRequested: z.boolean().default(false),
    drafts: z.enum(["include", "exclude", "only"]).default("include"),
    title: z.string().trim().max(256).default(""),
    head: z.string().trim().min(1).max(255).optional(),
    labels: z
      .array(z.string().trim().min(1).max(100))
      .max(20)
      .default([])
      .transform((labels) => [...new Set(labels)]),
    sort: z.enum(["updated-desc", "updated-asc"]).default("updated-desc"),
  })
  .superRefine((filters, context) => {
    if (filters.author === "username" && !filters.username) {
      context.addIssue({
        code: "custom",
        path: ["username"],
        message: "A GitHub username is required for username author filters.",
      });
    }
  });
export type GithubPrListFilters = z.infer<typeof githubPrListFiltersSchema>;

export const githubPrListRequestSchema = gitRemoteOpRequestSchema.extend({
  filters: githubPrListFiltersSchema.default({
    author: "any",
    reviewRequested: false,
    drafts: "include",
    title: "",
    labels: [],
    sort: "updated-desc",
  }),
});
export type GithubPrListRequest = z.infer<typeof githubPrListRequestSchema>;

export const githubPrCommentSchema = z.object({
  id: z.string(),
  author: z.string().nullable(),
  authorAvatarUrl: z.string().optional(),
  body: z.string(),
  createdAt: z.string(),
  updatedAt: z.string().optional(),
  url: z.string().optional(),
});
export type GithubPrComment = z.infer<typeof githubPrCommentSchema>;

export const githubPrReviewSummarySchema = z.object({
  id: z.string(),
  author: z.string().nullable(),
  authorAvatarUrl: z.string().optional(),
  state: z.string(),
  body: z.string(),
  submittedAt: z.string(),
  url: z.string().optional(),
});
export type GithubPrReviewSummary = z.infer<typeof githubPrReviewSummarySchema>;

export const githubPrLabelSchema = z.object({
  name: z.string(),
  color: z.string().optional(),
});
export type GithubPrLabel = z.infer<typeof githubPrLabelSchema>;

export const githubPrReviewerSchema = z.object({
  login: z.string(),
  avatarUrl: z.string().optional(),
});
export type GithubPrReviewer = z.infer<typeof githubPrReviewerSchema>;

export const githubPrMergeMethodSchema = z.enum(["merge", "squash", "rebase"]);
export type GithubPrMergeMethod = z.infer<typeof githubPrMergeMethodSchema>;

export const githubPrMergeSettingsSchema = z.object({
  allowedMethods: z.array(githubPrMergeMethodSchema),
});
export type GithubPrMergeSettings = z.infer<typeof githubPrMergeSettingsSchema>;

export const githubPrFileStatusSchema = z.enum([
  "added",
  "changed",
  "copied",
  "modified",
  "removed",
  "renamed",
  "unchanged",
]);
export type GithubPrFileStatus = z.infer<typeof githubPrFileStatusSchema>;

export const githubPrFileSchema = z.object({
  path: z.string(),
  previousPath: z.string().optional(),
  status: githubPrFileStatusSchema,
  additions: z.number().int().nonnegative(),
  deletions: z.number().int().nonnegative(),
  changes: z.number().int().nonnegative(),
});
export type GithubPrFile = z.infer<typeof githubPrFileSchema>;

export const githubPrFilesResponseSchema = z.object({
  files: z.array(githubPrFileSchema),
  totalCount: z.number().int().nonnegative(),
  truncated: z.boolean(),
});
export type GithubPrFilesResponse = z.infer<typeof githubPrFilesResponseSchema>;

export const githubPrFileDiffRequestSchema = gitRemoteOpRequestSchema.extend({
  path: z.string().min(1),
  previousPath: z.string().min(1).optional(),
  status: githubPrFileStatusSchema,
  expectedBaseRefOid: z.string().min(7),
  expectedHeadRefOid: z.string().min(7),
  expectedHeadRepository: z.string().min(3).optional(),
});
export type GithubPrFileDiffRequest = z.infer<
  typeof githubPrFileDiffRequestSchema
>;

const githubPrFileDiffMetadataSchema = z.object({
  path: z.string(),
  previousPath: z.string().optional(),
  baseRefOid: z.string(),
  headRefOid: z.string(),
});

export const githubPrFileDiffUnavailableReasonSchema = z.enum([
  "content-too-large",
  "repository-unavailable",
  "content-unavailable",
]);
export type GithubPrFileDiffUnavailableReason = z.infer<
  typeof githubPrFileDiffUnavailableReasonSchema
>;

export const githubPrFileDiffResponseSchema = z.discriminatedUnion("kind", [
  githubPrFileDiffMetadataSchema.extend({
    kind: z.literal("text"),
    original: z.string(),
    modified: z.string(),
  }),
  githubPrFileDiffMetadataSchema.extend({ kind: z.literal("binary") }),
  githubPrFileDiffMetadataSchema.extend({
    kind: z.literal("unavailable"),
    reason: githubPrFileDiffUnavailableReasonSchema,
  }),
]);
export type GithubPrFileDiffResponse = z.infer<
  typeof githubPrFileDiffResponseSchema
>;

export const githubPrCommitSchema = z.object({
  oid: z.string(),
  abbrev: z.string(),
  messageHeadline: z.string(),
  authoredDate: z.string().optional(),
  authorName: z.string().optional(),
  authorLogin: z.string().optional(),
  additions: z.number().int().nonnegative().optional(),
  deletions: z.number().int().nonnegative().optional(),
});
export type GithubPrCommit = z.infer<typeof githubPrCommitSchema>;

export const githubPrCoreSchema = githubPrSchema
  .omit({ checks: true, labels: true, reviewRequested: true })
  .extend({
    author: z.string().nullable(),
    createdAt: z.string(),
    additions: z.number().int().nonnegative(),
    deletions: z.number().int().nonnegative(),
    changedFiles: z.number().int().nonnegative(),
    headRefOid: z.string(),
    baseRefOid: z.string(),
    headRepository: z.string().nullable().optional(),
  });
export type GithubPrCore = z.infer<typeof githubPrCoreSchema>;

export const githubPrConversationSchema = z.object({
  body: z.string(),
  comments: z.array(githubPrCommentSchema),
  reviews: z.array(githubPrReviewSummarySchema),
});
export type GithubPrConversation = z.infer<typeof githubPrConversationSchema>;

export const githubPrOverviewSchema = z.object({
  mergeable: z.string().nullable(),
  mergeStateStatus: z.string().nullable(),
  reviewDecision: z.string().nullable(),
  /** GitHub's per-viewer bypass answer; covers both rulesets and classic
   * branch protection, unlike the actor-agnostic `mergeStateStatus`. */
  viewerCanMergeAsAdmin: z.boolean().default(false),
  behindBy: z.number().int().nonnegative().nullable(),
  /* Outcome metadata: a merged or closed PR has no merge controls, so the pane
   * reports what happened instead. */
  mergedAt: z.string().nullable().default(null),
  mergedBy: z.string().nullable().default(null),
  mergeCommitOid: z.string().nullable().default(null),
  closedAt: z.string().nullable().default(null),
  labels: z.array(githubPrLabelSchema),
  reviewRequests: z.array(githubPrReviewerSchema),
  mergeSettings: githubPrMergeSettingsSchema,
});
export type GithubPrOverview = z.infer<typeof githubPrOverviewSchema>;

export const githubPrInitialSchema = z.object({
  core: githubPrCoreSchema,
  conversation: githubPrConversationSchema,
  overview: githubPrOverviewSchema,
});
export type GithubPrInitial = z.infer<typeof githubPrInitialSchema>;

export const githubPrCommitsResponseSchema = z.object({
  commits: z.array(githubPrCommitSchema),
});
export type GithubPrCommitsResponse = z.infer<
  typeof githubPrCommitsResponseSchema
>;

export const githubPrChecksResponseSchema = z.object({
  checks: githubChecksSummarySchema,
});
export type GithubPrChecksResponse = z.infer<
  typeof githubPrChecksResponseSchema
>;

export const githubPrCheckoutResponseSchema = z.object({
  repo: gitRepoSummarySchema,
  number: z.number().int(),
});
export type GithubPrCheckoutResponse = z.infer<
  typeof githubPrCheckoutResponseSchema
>;

export const githubPrMergeRequestSchema = gitRemoteOpRequestSchema.extend({
  method: githubPrMergeMethodSchema,
  expectedHeadOid: z.string().min(7),
});
export type GithubPrMergeRequest = z.infer<typeof githubPrMergeRequestSchema>;

export const githubPrMergeResponseSchema = z.object({
  number: z.number().int().positive(),
  merged: z.boolean(),
  url: z.string(),
});
export type GithubPrMergeResponse = z.infer<typeof githubPrMergeResponseSchema>;

// --- Live pull request sync ---

export const githubPrSyncStatusSchema = z.enum([
  /** Snapshot reflects the latest probe. */
  "fresh",
  /** No successful probe yet, or the last one is older than its tier allows. */
  "stale",
  "rate_limited",
  "unauthenticated",
  /** No GitHub remote, or gh/token unavailable. */
  "unavailable",
  "error",
]);
export type GithubPrSyncStatus = z.infer<typeof githubPrSyncStatusSchema>;

const githubPrRepoParamsSchema = z.object({
  projectId: z.string().startsWith("proj_"),
  repo: z.string().min(1).max(1_024),
});

/**
 * Server-owned, in-memory view of one repository's pull requests. `prs` holds
 * up to 100 open PRs plus retained closed/merged PRs (watched tabs and the
 * current branch's latest PR); clients filter it locally.
 */
export const githubPrSnapshotSchema = githubPrRepoParamsSchema.extend({
  revision: z.number().int().nonnegative(),
  status: githubPrSyncStatusSchema,
  /** ISO time of the last successful probe. */
  updatedAt: z.string().nullable(),
  /** More open PRs exist than the snapshot holds; use `github.pr.list`. */
  truncated: z.boolean(),
  /** `https://<host>/<owner>/<name>` of the GitHub remote; null until resolved. */
  repositoryUrl: z.string().nullable().default(null),
  viewer: z.string().nullable(),
  /** Retry hint while `status` is `rate_limited` or `error`. */
  retryAt: z.string().nullable().default(null),
  prs: z.array(githubPrSchema),
});
export type GithubPrSnapshot = z.infer<typeof githubPrSnapshotSchema>;

export const githubPrSnapshotRequestSchema = githubPrRepoParamsSchema;
export type GithubPrSnapshotRequest = z.infer<
  typeof githubPrSnapshotRequestSchema
>;

/** This connection's demand for one repository; replaces earlier demand. */
export const githubPrWatchSyncRequestSchema = githubPrRepoParamsSchema.extend({
  /** Some surface showing this repository's PRs is on screen. */
  visible: z.boolean(),
  /** The PR list is shown. */
  list: z.boolean().default(false),
  /** Branch whose PR is shown (Git Changes card, branch row). */
  branch: z.string().min(1).max(255).optional(),
  /** PRs open in tabs, including closed or merged ones to retain. */
  prs: z.array(z.number().int().positive()).max(50).default([]),
  /** Focused PR tab; its checks are probed at the hot tier when pending. */
  activePr: z.number().int().positive().optional(),
});
export type GithubPrWatchSyncRequest = z.infer<
  typeof githubPrWatchSyncRequestSchema
>;

export const githubPrWatchClearRequestSchema = githubPrRepoParamsSchema;
export type GithubPrWatchClearRequest = z.infer<
  typeof githubPrWatchClearRequestSchema
>;

export const githubPrWatchStateSchema = z.object({
  revision: z.number().int(),
});
export type GithubPrWatchState = z.infer<typeof githubPrWatchStateSchema>;

/** Probe now (bypasses the tier interval, never rate-limit backoff). */
export const githubPrRefreshRequestSchema = githubPrRepoParamsSchema.extend({
  /** Also refetch this PR's summary even when the list probe is unchanged. */
  number: z.number().int().positive().optional(),
});
export type GithubPrRefreshRequest = z.infer<
  typeof githubPrRefreshRequestSchema
>;

/** A PR is likely to be created for `branch` soon (compare URL opened). */
export const githubPrExpectRequestSchema = githubPrRepoParamsSchema.extend({
  branch: z.string().min(1).max(255),
});
export type GithubPrExpectRequest = z.infer<typeof githubPrExpectRequestSchema>;

export const githubPrAckSchema = z.object({ accepted: z.boolean() });
export type GithubPrAck = z.infer<typeof githubPrAckSchema>;
