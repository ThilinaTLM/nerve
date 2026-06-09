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

export const gitDiscoveryResponseSchema = z.object({
  projectIsRepo: z.boolean(),
  repos: z.array(gitRepoSummarySchema),
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

export const gitRecentCommitSchema = z.object({
  hash: z.string(),
  subject: z.string(),
  relativeDate: z.string(),
});
export type GitRecentCommit = z.infer<typeof gitRecentCommitSchema>;

export const gitOverviewResponseSchema = z.object({
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
});
export type GitOverviewResponse = z.infer<typeof gitOverviewResponseSchema>;

export const gitBranchSummarySchema = z.object({
  /** Branch display/ref name, e.g. `main` or `origin/main`. */
  name: z.string(),
  current: z.boolean(),
  remote: z.boolean(),
  upstream: z.string().nullable(),
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

/** Generic remote operation (push / pull / fetch) on the current branch. */
export const gitRemoteOpRequestSchema = z.object({
  repo: z.string().default("."),
});
export type GitRemoteOpRequest = z.infer<typeof gitRemoteOpRequestSchema>;

export const gitFileActionRequestSchema = z.object({
  repo: z.string().default("."),
  path: z.string().min(1),
});
export type GitFileActionRequest = z.infer<typeof gitFileActionRequestSchema>;

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

export const githubPrSchema = z.object({
  number: z.number().int(),
  title: z.string(),
  url: z.string(),
  state: z.string(),
  isDraft: z.boolean(),
  headRefName: z.string(),
  baseRefName: z.string(),
  updatedAt: z.string(),
  checks: githubChecksSummarySchema,
});
export type GithubPr = z.infer<typeof githubPrSchema>;

export const githubPrListResponseSchema = z.object({
  prs: z.array(githubPrSchema),
});
export type GithubPrListResponse = z.infer<typeof githubPrListResponseSchema>;

export const githubPrFileSchema = z.object({
  path: z.string(),
  additions: z.number().int().nonnegative(),
  deletions: z.number().int().nonnegative(),
});
export type GithubPrFile = z.infer<typeof githubPrFileSchema>;

export const githubPrCommitSchema = z.object({
  oid: z.string(),
  abbrev: z.string(),
  messageHeadline: z.string(),
  authoredDate: z.string().optional(),
  authorName: z.string().optional(),
});
export type GithubPrCommit = z.infer<typeof githubPrCommitSchema>;

export const githubPrDetailSchema = githubPrSchema.extend({
  body: z.string(),
  author: z.string().nullable(),
  createdAt: z.string(),
  additions: z.number().int().nonnegative(),
  deletions: z.number().int().nonnegative(),
  changedFiles: z.number().int().nonnegative(),
  mergeable: z.string().nullable(),
  reviewDecision: z.string().nullable(),
  files: z.array(githubPrFileSchema),
  commits: z.array(githubPrCommitSchema),
});
export type GithubPrDetail = z.infer<typeof githubPrDetailSchema>;

export const githubPrCheckoutResponseSchema = z.object({
  repo: gitRepoSummarySchema,
  number: z.number().int(),
});
export type GithubPrCheckoutResponse = z.infer<
  typeof githubPrCheckoutResponseSchema
>;
