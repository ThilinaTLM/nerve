import type {
  GithubPr,
  GithubPrCheckoutResponse,
  GithubPrCommit,
  GithubPrDetail,
  GithubPrFile,
  GithubPrFilesResponse,
  GithubPrListFilters,
  GithubPrListResponse,
  GithubPrMergeMethod,
  GithubPrMergeResponse,
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
  invalidateStableMetadata(repoDir: string): void;
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

type GithubAuthorRaw = {
  login?: string;
  avatarUrl?: string;
} | null;

type GithubPrDetailRaw = {
  number: number;
  title: string;
  url: string;
  state: string;
  isDraft: boolean;
  headRefName: string;
  baseRefName: string;
  headRefOid?: string;
  baseRefOid?: string;
  updatedAt: string;
  createdAt: string;
  body?: string | null;
  author?: GithubAuthorRaw;
  additions?: number;
  deletions?: number;
  changedFiles?: number;
  mergeable?: string | null;
  mergeStateStatus?: string | null;
  reviewDecision?: string | null;
  comments?: Array<{
    id?: string;
    databaseId?: number;
    author?: GithubAuthorRaw;
    body?: string;
    createdAt?: string;
    updatedAt?: string;
    url?: string;
  }>;
  reviews?: Array<{
    id?: string;
    databaseId?: number;
    author?: GithubAuthorRaw;
    state?: string;
    body?: string;
    submittedAt?: string;
    url?: string;
  }>;
  labels?: Array<{ name?: string; color?: string }>;
  reviewRequests?: Array<{
    login?: string;
    avatarUrl?: string;
    requestedReviewer?: { login?: string; avatarUrl?: string };
  }>;
  commits?: Array<{
    oid: string;
    messageHeadline?: string;
    authoredDate?: string;
    authors?: Array<{ name?: string }>;
  }>;
};

type GithubRepoMergeRaw = {
  nameWithOwner?: string;
  mergeCommitAllowed?: boolean;
  squashMergeAllowed?: boolean;
  rebaseMergeAllowed?: boolean;
};

export function allowedMergeMethods(
  raw: GithubRepoMergeRaw,
): GithubPrMergeMethod[] {
  const methods: GithubPrMergeMethod[] = [];
  if (raw.mergeCommitAllowed) methods.push("merge");
  if (raw.squashMergeAllowed) methods.push("squash");
  if (raw.rebaseMergeAllowed) methods.push("rebase");
  return methods;
}

async function repoMergeSettings(
  context: GithubServiceContext,
  repoDir: string,
): Promise<{ nameWithOwner: string; allowedMethods: GithubPrMergeMethod[] }> {
  const { stdout } = await context.mapGh(() =>
    context.runGh(repoDir, [
      "repo",
      "view",
      "--json",
      "nameWithOwner,mergeCommitAllowed,squashMergeAllowed,rebaseMergeAllowed",
    ]),
  );
  const raw = JSON.parse(stdout || "{}") as GithubRepoMergeRaw;
  return {
    nameWithOwner: raw.nameWithOwner ?? "{owner}/{repo}",
    allowedMethods: allowedMergeMethods(raw),
  };
}

async function prBehindBy(
  context: GithubServiceContext,
  repoDir: string,
  nameWithOwner: string,
  baseOid: string,
  headOid: string,
): Promise<number | null> {
  if (!baseOid || !headOid) return null;
  try {
    const { stdout } = await context.runGh(repoDir, [
      "api",
      `repos/${nameWithOwner}/compare/${baseOid}...${headOid}`,
      "--jq",
      ".behind_by",
    ]);
    const value = Number(stdout.trim());
    return Number.isInteger(value) && value >= 0 ? value : null;
  } catch {
    return null;
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
      "number,title,url,state,isDraft,headRefName,baseRefName,headRefOid,baseRefOid,updatedAt,createdAt,body,author,additions,deletions,changedFiles,commits,mergeable,mergeStateStatus,reviewDecision,comments,reviews,labels,reviewRequests",
    ]),
  );
  const raw = JSON.parse(stdout || "{}") as GithubPrDetailRaw;
  const checksPromise = prChecks(context, repoDir, number);
  const settings = await repoMergeSettings(context, repoDir);
  const [checks, behindBy] = await Promise.all([
    checksPromise,
    prBehindBy(
      context,
      repoDir,
      settings.nameWithOwner,
      raw.baseRefOid ?? "",
      raw.headRefOid ?? "",
    ),
  ]);
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
    headRefOid: raw.headRefOid ?? "",
    baseRefOid: raw.baseRefOid ?? "",
    updatedAt: raw.updatedAt,
    createdAt: raw.createdAt,
    body: raw.body ?? "",
    author: raw.author?.login ?? null,
    additions: raw.additions ?? 0,
    deletions: raw.deletions ?? 0,
    changedFiles: raw.changedFiles ?? 0,
    mergeable: raw.mergeable ?? null,
    mergeStateStatus: raw.mergeStateStatus ?? null,
    reviewDecision: raw.reviewDecision ?? null,
    behindBy,
    comments: (raw.comments ?? []).map((comment, index) => ({
      id: String(comment.id ?? comment.databaseId ?? `comment-${index}`),
      author: comment.author?.login ?? null,
      authorAvatarUrl: comment.author?.avatarUrl,
      body: comment.body ?? "",
      createdAt: comment.createdAt ?? raw.createdAt,
      updatedAt: comment.updatedAt,
      url: comment.url,
    })),
    reviews: (raw.reviews ?? []).map((review, index) => ({
      id: String(review.id ?? review.databaseId ?? `review-${index}`),
      author: review.author?.login ?? null,
      authorAvatarUrl: review.author?.avatarUrl,
      state: review.state ?? "COMMENTED",
      body: review.body ?? "",
      submittedAt: review.submittedAt ?? raw.updatedAt,
      url: review.url,
    })),
    labels: (raw.labels ?? [])
      .filter((label): label is { name: string; color?: string } =>
        Boolean(label.name),
      )
      .map((label) => ({ name: label.name, color: label.color })),
    reviewRequests: (raw.reviewRequests ?? []).flatMap((request) => {
      const reviewer = request.requestedReviewer ?? request;
      return reviewer.login
        ? [{ login: reviewer.login, avatarUrl: reviewer.avatarUrl }]
        : [];
    }),
    mergeSettings: { allowedMethods: settings.allowedMethods },
    commits,
    checks,
  };
}

const MAX_PR_FILES = 300;
const PR_FILES_PER_PAGE = 100;
const MAX_PR_PATCH_BYTES = 2 * 1024 * 1024;

function truncateUtf8(value: string, maxBytes: number): string {
  if (Buffer.byteLength(value, "utf8") <= maxBytes) return value;
  let low = 0;
  let high = value.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (Buffer.byteLength(value.slice(0, middle), "utf8") <= maxBytes) {
      low = middle;
    } else {
      high = middle - 1;
    }
  }
  return value.slice(0, low);
}

type GithubPrFileRaw = {
  filename?: string;
  previous_filename?: string;
  status?: string;
  additions?: number;
  deletions?: number;
  changes?: number;
  patch?: string;
};

function fileStatus(value?: string): GithubPrFile["status"] {
  switch (value) {
    case "added":
    case "changed":
    case "copied":
    case "modified":
    case "removed":
    case "renamed":
    case "unchanged":
      return value;
    default:
      return "changed";
  }
}

export async function prFiles(
  context: GithubServiceContext,
  projectId: string,
  relativePath: string,
  number: number,
): Promise<GithubPrFilesResponse> {
  const repoDir = context.resolveRepoDir(projectId, relativePath);
  await context.ensureGithubRemote(repoDir);
  const countResult = await context.mapGh(() =>
    context.runGh(repoDir, [
      "pr",
      "view",
      String(number),
      "--json",
      "changedFiles",
      "--jq",
      ".changedFiles",
    ]),
  );
  const rawFiles: GithubPrFileRaw[] = [];
  for (let page = 1; page <= MAX_PR_FILES / PR_FILES_PER_PAGE; page += 1) {
    const { stdout } = await context.mapGh(() =>
      context.runGh(repoDir, [
        "api",
        `repos/{owner}/{repo}/pulls/${number}/files?per_page=${PR_FILES_PER_PAGE}&page=${page}`,
      ]),
    );
    const pageFiles = JSON.parse(stdout || "[]") as GithubPrFileRaw[];
    rawFiles.push(...pageFiles);
    if (pageFiles.length < PR_FILES_PER_PAGE) break;
  }
  const totalValue = Number(countResult.stdout.trim());
  const totalCount = Number.isInteger(totalValue)
    ? totalValue
    : rawFiles.length;
  let patchBytesRemaining = MAX_PR_PATCH_BYTES;
  let boundedPatches = false;
  const files = rawFiles.slice(0, MAX_PR_FILES).flatMap((file) => {
    if (!file.filename) return [];
    const rawPatch = file.patch;
    let patch: string | null = rawPatch ?? null;
    let patchTruncated = false;
    if (rawPatch) {
      const bounded = truncateUtf8(rawPatch, patchBytesRemaining);
      patch = bounded.length > 0 ? bounded : null;
      patchTruncated = bounded.length < rawPatch.length;
      boundedPatches ||= patchTruncated;
      patchBytesRemaining -= Buffer.byteLength(bounded, "utf8");
    }
    return [
      {
        path: file.filename,
        previousPath: file.previous_filename,
        status: fileStatus(file.status),
        additions: file.additions ?? 0,
        deletions: file.deletions ?? 0,
        changes: file.changes ?? 0,
        patch,
        patchTruncated,
      },
    ];
  });
  return {
    files,
    totalCount,
    truncated: totalCount > files.length || boundedPatches,
  };
}

const mergeMethodFlag: Record<GithubPrMergeMethod, string> = {
  merge: "--merge",
  squash: "--squash",
  rebase: "--rebase",
};

export async function mergePr(
  context: GithubServiceContext,
  projectId: string,
  relativePath: string,
  number: number,
  method: GithubPrMergeMethod,
  expectedHeadOid: string,
): Promise<GithubPrMergeResponse> {
  const repoDir = context.resolveRepoDir(projectId, relativePath);
  await context.ensureGithubRemote(repoDir);
  const [settings, urlResult] = await Promise.all([
    repoMergeSettings(context, repoDir),
    context.mapGh(() =>
      context.runGh(repoDir, [
        "pr",
        "view",
        String(number),
        "--json",
        "url",
        "--jq",
        ".url",
      ]),
    ),
  ]);
  if (!settings.allowedMethods.includes(method)) {
    throw new GitWorkflowError(
      409,
      "GH_PR_MERGE_METHOD_DISABLED",
      `The repository does not allow the ${method} merge method.`,
    );
  }
  await context.mapGh(() =>
    context.runGh(repoDir, [
      "pr",
      "merge",
      String(number),
      mergeMethodFlag[method],
      "--match-head-commit",
      expectedHeadOid,
    ]),
  );
  context.invalidateStableMetadata(repoDir);
  return {
    number,
    merged: true,
    url: urlResult.stdout.trim(),
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
  context.invalidateStableMetadata(repoDir);
  return {
    repo: await context.summarizeRepo(
      repoDir,
      relativePath,
      context.repoName(projectId, relativePath),
    ),
    number,
  };
}
