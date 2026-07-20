import type {
  GithubPr,
  GithubPrCheckoutResponse,
  GithubPrCommit,
  GithubPrDetail,
  GithubPrFile,
  GithubPrListFilters,
  GithubPrListResponse,
  GithubStatusResponse,
  GitRepoSummary,
} from "@nervekit/contracts";
import { GitWorkflowError } from "./git-errors.js";
import {
  noChecksSummary,
  parseGithubChecks,
  summarizeStatusCheckRollup,
} from "./git-github-parsers.js";
import { parsePorcelainV2 } from "./git-status.js";

type ExecResult = { stdout: string; stderr: string };

type GitCommandLikeError = Error & {
  code: number | null;
  stdout: string;
  stderr: string;
};

export type GithubServiceContext = {
  resolveRepoDir(projectId: string, relativePath: string): string;
  repoRemoteState(repoDir: string): Promise<{
    hasRemote: boolean;
    hasGithubRemote: boolean;
  }>;
  runGh(repoDir: string, args: string[]): Promise<ExecResult>;
  runGit(repoDir: string, args: string[]): Promise<ExecResult>;
  ensureGithubRemote(repoDir: string): Promise<void>;
  mapGh<T>(fn: () => Promise<T>): Promise<T>;
  summarizeRepo(
    repoDir: string,
    relativePath: string,
    name: string,
  ): Promise<GitRepoSummary>;
  repoName(projectId: string, relativePath: string): string;
  isGitCommandError(error: unknown): error is GitCommandLikeError;
};

export async function githubStatus(
  context: GithubServiceContext,
  projectId: string,
  relativePath: string,
): Promise<GithubStatusResponse> {
  const repoDir = context.resolveRepoDir(projectId, relativePath);
  const remoteState = await context.repoRemoteState(repoDir);
  if (!remoteState.hasRemote) {
    return {
      available: false,
      authenticated: false,
      login: null,
      reason: "No remote repository configured.",
    };
  }
  if (!remoteState.hasGithubRemote) {
    return {
      available: false,
      authenticated: false,
      login: null,
      reason: "Remote repository is not GitHub.",
    };
  }

  try {
    await context.runGh(repoDir, ["--version"]);
  } catch {
    return {
      available: false,
      authenticated: false,
      login: null,
      reason: "GitHub CLI (gh) is not installed.",
    };
  }
  try {
    const { stdout } = await context.runGh(repoDir, [
      "api",
      "user",
      "--jq",
      ".login",
    ]);
    const login = stdout.trim();
    return {
      available: true,
      authenticated: login.length > 0,
      login: login.length > 0 ? login : null,
    };
  } catch (error) {
    return {
      available: true,
      authenticated: false,
      login: null,
      reason: context.isGitCommandError(error)
        ? "Not authenticated. Run `gh auth login`."
        : "GitHub authentication check failed.",
    };
  }
}

export function githubPrListArgs(filters: GithubPrListFilters): string[] {
  const args = ["pr", "list", "--state", "open", "--limit", "10"];
  if (filters.author === "me") args.push("--author", "@me");
  if (filters.author === "username" && filters.username) {
    args.push("--author", filters.username);
  }
  if (filters.head) args.push("--head", filters.head);
  for (const label of filters.labels) args.push("--label", label);

  const search = [`sort:${filters.sort}`];
  if (filters.title) search.push(`in:title ${quoteSearchValue(filters.title)}`);
  if (filters.drafts === "exclude") search.push("draft:false");
  if (filters.drafts === "only") search.push("draft:true");
  args.push("--search", search.join(" "));
  args.push(
    "--json",
    "number,title,url,state,isDraft,headRefName,baseRefName,updatedAt,statusCheckRollup",
  );
  return args;
}

function quoteSearchValue(value: string): string {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

export async function listOpenPrs(
  context: GithubServiceContext,
  projectId: string,
  relativePath: string,
  filters: GithubPrListFilters,
): Promise<GithubPrListResponse> {
  const repoDir = context.resolveRepoDir(projectId, relativePath);
  await context.ensureGithubRemote(repoDir);
  const { stdout } = await context.mapGh(() =>
    context.runGh(repoDir, githubPrListArgs(filters)),
  );
  const raw = JSON.parse(stdout || "[]") as Array<{
    number: number;
    title: string;
    url: string;
    state: string;
    isDraft: boolean;
    headRefName: string;
    baseRefName: string;
    updatedAt: string;
    statusCheckRollup?: unknown[] | null;
  }>;
  return {
    prs: raw.slice(0, 10).map(
      (pr): GithubPr => ({
        number: pr.number,
        title: pr.title,
        url: pr.url,
        state: pr.state,
        isDraft: pr.isDraft,
        headRefName: pr.headRefName,
        baseRefName: pr.baseRefName,
        updatedAt: pr.updatedAt,
        checks: summarizeStatusCheckRollup(pr.statusCheckRollup),
      }),
    ),
  };
}

async function prChecks(
  context: GithubServiceContext,
  repoDir: string,
  number: number,
): Promise<ReturnType<typeof noChecksSummary>> {
  try {
    const { stdout } = await context.runGh(repoDir, [
      "pr",
      "checks",
      String(number),
      "--json",
      "name,state,link",
    ]);
    return parseGithubChecks(stdout);
  } catch (error) {
    if (context.isGitCommandError(error) && error.stdout.trim().length > 0) {
      try {
        return parseGithubChecks(error.stdout);
      } catch {
        // Fall through to the no-checks fallback below.
      }
    }
    return noChecksSummary();
  }
}

export async function prDetail(
  context: GithubServiceContext,
  projectId: string,
  relativePath: string,
  number: number,
): Promise<GithubPrDetail> {
  const repoDir = context.resolveRepoDir(projectId, relativePath);
  await context.ensureGithubRemote(repoDir);
  const { stdout } = await context.mapGh(() =>
    context.runGh(repoDir, [
      "pr",
      "view",
      String(number),
      "--json",
      "number,title,url,state,isDraft,headRefName,baseRefName,updatedAt,createdAt,body,author,additions,deletions,changedFiles,files,commits,mergeable,reviewDecision",
    ]),
  );
  const raw = JSON.parse(stdout || "{}") as {
    number: number;
    title: string;
    url: string;
    state: string;
    isDraft: boolean;
    headRefName: string;
    baseRefName: string;
    updatedAt: string;
    createdAt: string;
    body?: string | null;
    author?: { login?: string } | null;
    additions?: number;
    deletions?: number;
    changedFiles?: number;
    mergeable?: string | null;
    reviewDecision?: string | null;
    files?: Array<{ path: string; additions?: number; deletions?: number }>;
    commits?: Array<{
      oid: string;
      messageHeadline?: string;
      authoredDate?: string;
      authors?: Array<{ name?: string }>;
    }>;
  };
  const checks = await prChecks(context, repoDir, number);
  const files: GithubPrFile[] = (raw.files ?? []).map((file) => ({
    path: file.path,
    additions: file.additions ?? 0,
    deletions: file.deletions ?? 0,
  }));
  const commits: GithubPrCommit[] = (raw.commits ?? []).map((commit) => ({
    oid: commit.oid,
    abbrev: commit.oid.slice(0, 7),
    messageHeadline: commit.messageHeadline ?? "",
    authoredDate: commit.authoredDate,
    authorName: commit.authors?.[0]?.name,
  }));
  return {
    number: raw.number,
    title: raw.title,
    url: raw.url,
    state: raw.state,
    isDraft: raw.isDraft,
    headRefName: raw.headRefName,
    baseRefName: raw.baseRefName,
    updatedAt: raw.updatedAt,
    createdAt: raw.createdAt,
    body: raw.body ?? "",
    author: raw.author?.login ?? null,
    additions: raw.additions ?? 0,
    deletions: raw.deletions ?? 0,
    changedFiles: raw.changedFiles ?? files.length,
    mergeable: raw.mergeable ?? null,
    reviewDecision: raw.reviewDecision ?? null,
    files,
    commits,
    checks,
  };
}

export async function checkoutPr(
  context: GithubServiceContext,
  projectId: string,
  relativePath: string,
  number: number,
): Promise<GithubPrCheckoutResponse> {
  const repoDir = context.resolveRepoDir(projectId, relativePath);
  await context.ensureGithubRemote(repoDir);
  const { files } = parsePorcelainV2(
    (await context.runGit(repoDir, ["status", "--porcelain=v2"])).stdout,
  );
  if (files.length > 0) {
    throw new GitWorkflowError(
      409,
      "GIT_DIRTY_WORKTREE",
      "Working tree has uncommitted changes. Commit or stash them before checking out a PR.",
    );
  }
  await context.mapGh(() =>
    context.runGh(repoDir, ["pr", "checkout", String(number)]),
  );
  return {
    repo: await context.summarizeRepo(
      repoDir,
      relativePath,
      context.repoName(projectId, relativePath),
    ),
    number,
  };
}
