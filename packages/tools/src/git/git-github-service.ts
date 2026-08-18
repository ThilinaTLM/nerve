/* eslint-disable max-lines -- GitHub workflows share one typed mapping boundary across GraphQL and REST resources. */
import type {
  GithubPr,
  GithubPrCheckoutResponse,
  GithubPrChecksResponse,
  GithubPrCommitsResponse,
  GithubPrConversation,
  GithubPrCore,
  GithubPrFile,
  GithubPrFileDiffRequest,
  GithubPrFileDiffResponse,
  GithubPrFilesResponse,
  GithubPrInitial,
  GithubPrListFilters,
  GithubPrListResponse,
  GithubPrMergeMethod,
  GithubPrMergeResponse,
  GithubPrOverview,
  GithubStatusResponse,
  GitRepoSummary,
} from "@nervekit/contracts";
import { GitWorkflowError } from "./git-errors.js";
import type { GithubApiClient } from "./git-github-api-client.js";
import {
  noChecksSummary,
  parseGithubRepositoryUrl,
  summarizeStatusCheckRollup,
} from "./git-github-parsers.js";
import type { GithubRepositoryRef } from "./git-github-parsers.js";
import type { GitReadSnapshot } from "./git-read-backend.js";

type ExecResult = { stdout: string; stderr: string };
type RemoteState = {
  hasRemote: boolean;
  hasGithubRemote: boolean;
  githubRepository: GithubRepositoryRef | null;
};

export type GithubServiceContext = {
  resolveRepoDir(projectId: string, relativePath: string): string;
  repoRemoteState(repoDir: string): Promise<RemoteState>;
  githubApi: GithubApiClient;
  runGit(repoDir: string, args: string[]): Promise<ExecResult>;
  mapGit<T>(fn: () => Promise<T>): Promise<T>;
  readSnapshot(repoDir: string): Promise<GitReadSnapshot>;
  isAncestor(
    repoDir: string,
    ancestor: string,
    descendant: string,
  ): Promise<boolean>;
  resolveRevision(repoDir: string, revision: string): Promise<string>;
  ensureGithubRemote(repoDir: string): Promise<void>;
  invalidateStableMetadata(repoDir: string): void;
  summarizeRepo(
    repoDir: string,
    relativePath: string,
    name: string,
  ): Promise<GitRepoSummary>;
  repoName(projectId: string, relativePath: string): string;
};

type GithubAuthorRaw = { login?: string; avatarUrl?: string } | null;
type GithubCheckRollupRaw = {
  contexts?: { nodes?: unknown[] | null } | null;
} | null;
type GithubCommitNodeRaw = {
  oid: string;
  messageHeadline?: string;
  authoredDate?: string;
  authors?: { nodes?: Array<{ name?: string } | null> | null } | null;
  statusCheckRollup?: GithubCheckRollupRaw;
};
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
  headRepository?: { nameWithOwner?: string } | null;
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
  comments?: {
    nodes?: Array<{
      id?: string;
      databaseId?: number;
      author?: GithubAuthorRaw;
      body?: string;
      createdAt?: string;
      updatedAt?: string;
      url?: string;
    } | null> | null;
  } | null;
  reviews?: {
    nodes?: Array<{
      id?: string;
      databaseId?: number;
      author?: GithubAuthorRaw;
      state?: string;
      body?: string;
      submittedAt?: string;
      url?: string;
    } | null> | null;
  } | null;
  labels?: {
    nodes?: Array<{ name?: string; color?: string } | null> | null;
  } | null;
  reviewRequests?: {
    nodes?: Array<{
      requestedReviewer?: {
        login?: string;
        slug?: string;
        avatarUrl?: string;
      } | null;
    } | null> | null;
  } | null;
  commits?: {
    nodes?: Array<{ commit?: GithubCommitNodeRaw } | null> | null;
  } | null;
};
type GithubRepoRaw = {
  mergeCommitAllowed?: boolean;
  squashMergeAllowed?: boolean;
  rebaseMergeAllowed?: boolean;
  pullRequest?: GithubPrDetailRaw | null;
};
type RepositoryResponse = { repository?: GithubRepoRaw | null };

const CORE_FIELDS = `
  number title url state isDraft headRefName baseRefName headRefOid baseRefOid
  headRepository { nameWithOwner }
  updatedAt createdAt additions deletions changedFiles
  author { login avatarUrl }
`;
const CONVERSATION_FIELDS = `
  body createdAt updatedAt
  comments(first: 100) {
    nodes { id databaseId body createdAt updatedAt url author { login avatarUrl } }
  }
  reviews(first: 100) {
    nodes { id databaseId state body submittedAt url author { login avatarUrl } }
  }
`;
const OVERVIEW_FIELDS = `
  headRefOid baseRefOid mergeable mergeStateStatus reviewDecision
  labels(first: 100) { nodes { name color } }
  reviewRequests(first: 100) {
    nodes {
      requestedReviewer {
        ... on User { login avatarUrl }
        ... on Team { slug avatarUrl }
      }
    }
  }
`;
const CHECK_FIELDS = `
  commits(last: 1) {
    nodes {
      commit {
        statusCheckRollup {
          contexts(first: 100) {
            nodes {
              __typename
              ... on CheckRun { name status conclusion detailsUrl }
              ... on StatusContext { context state targetUrl }
            }
          }
        }
      }
    }
  }
`;
const REPOSITORY_SETTINGS_FIELDS = `
  mergeCommitAllowed squashMergeAllowed rebaseMergeAllowed
`;

function repositoryQuery(fields: string, includeSettings = false): string {
  return `query PullRequest($owner: String!, $repo: String!, $number: Int!) {
    repository(owner: $owner, name: $repo) {
      ${includeSettings ? REPOSITORY_SETTINGS_FIELDS : ""}
      pullRequest(number: $number) { ${fields} }
    }
  }`;
}

function variables(repository: GithubRepositoryRef, number: number) {
  return { owner: repository.owner, repo: repository.repo, number };
}

function requireRepository(data: RepositoryResponse): GithubRepoRaw {
  if (!data.repository)
    throw new GitWorkflowError(
      404,
      "GH_NOT_FOUND",
      "GitHub repository not found.",
    );
  return data.repository;
}

function requirePr(repository: GithubRepoRaw): GithubPrDetailRaw {
  if (!repository.pullRequest)
    throw new GitWorkflowError(404, "GH_NOT_FOUND", "Pull request not found.");
  return repository.pullRequest;
}

async function preparePr(
  context: GithubServiceContext,
  projectId: string,
  relativePath: string,
): Promise<{ repoDir: string; repository: GithubRepositoryRef }> {
  const repoDir = context.resolveRepoDir(projectId, relativePath);
  await context.ensureGithubRemote(repoDir);
  const repository = (await context.repoRemoteState(repoDir)).githubRepository;
  if (!repository)
    throw new GitWorkflowError(
      409,
      "GH_NO_GITHUB_REMOTE",
      "This repository does not have a GitHub remote configured.",
    );
  return { repoDir, repository };
}

export async function githubStatus(
  context: GithubServiceContext,
  projectId: string,
  relativePath: string,
): Promise<GithubStatusResponse> {
  const repoDir = context.resolveRepoDir(projectId, relativePath);
  const remoteState = await context.repoRemoteState(repoDir);
  if (!remoteState.hasRemote)
    return {
      available: false,
      authenticated: false,
      login: null,
      reason: "No remote repository configured.",
    };
  if (!remoteState.githubRepository)
    return {
      available: false,
      authenticated: false,
      login: null,
      reason: "Remote repository is not GitHub.",
    };
  try {
    const user = await context.githubApi.rest<{ login?: string }>(
      remoteState.githubRepository,
      "/user",
      { operation: "github-status" },
    );
    const login = user.login?.trim() ?? "";
    return {
      available: true,
      authenticated: Boolean(login),
      login: login || null,
    };
  } catch (error) {
    if (error instanceof GitWorkflowError) {
      if (error.code === "GH_CLI_UNAVAILABLE")
        return {
          available: false,
          authenticated: false,
          login: null,
          reason: error.message,
        };
      if (error.code === "GH_AUTH_REQUIRED")
        return {
          available: true,
          authenticated: false,
          login: null,
          reason: error.message,
        };
    }
    return {
      available: true,
      authenticated: false,
      login: null,
      reason: "GitHub authentication check failed.",
    };
  }
}

function quoteSearchValue(value: string): string {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

export function githubPrSearch(filters: GithubPrListFilters): string {
  const search = ["is:pr", "is:open"];
  if (filters.author === "me") search.push("author:@me");
  if (filters.author === "username" && filters.username)
    search.push(`author:${quoteSearchValue(filters.username)}`);
  if (filters.head) search.push(`head:${quoteSearchValue(filters.head)}`);
  for (const label of filters.labels)
    search.push(`label:${quoteSearchValue(label)}`);
  if (filters.title) search.push(`in:title ${quoteSearchValue(filters.title)}`);
  if (filters.drafts === "exclude") search.push("draft:false");
  if (filters.drafts === "only") search.push("draft:true");
  search.push(
    `sort:updated-${filters.sort === "updated-asc" ? "asc" : "desc"}`,
  );
  return search.join(" ");
}

const PR_LIST_QUERY = `query PullRequests($query: String!) {
  search(query: $query, type: ISSUE, first: 10) {
    nodes {
      ... on PullRequest {
        number title url state isDraft headRefName baseRefName updatedAt
        ${CHECK_FIELDS}
      }
    }
  }
}`;

function checkRollup(raw: GithubPrDetailRaw): readonly unknown[] | null {
  return (
    raw.commits?.nodes?.[0]?.commit?.statusCheckRollup?.contexts?.nodes ?? null
  );
}

export async function listOpenPrs(
  context: GithubServiceContext,
  projectId: string,
  relativePath: string,
  filters: GithubPrListFilters,
): Promise<GithubPrListResponse> {
  const { repository } = await preparePr(context, projectId, relativePath);
  const data = await context.githubApi.graphql<{
    search?: { nodes?: Array<GithubPrDetailRaw | null> | null } | null;
  }>(repository, "list-pull-requests", PR_LIST_QUERY, {
    query: `repo:${repository.owner}/${repository.repo} ${githubPrSearch(filters)}`,
  });
  return {
    prs: (data.search?.nodes ?? []).flatMap((raw) =>
      raw
        ? [
            {
              number: raw.number,
              title: raw.title,
              url: raw.url,
              state: raw.state,
              isDraft: raw.isDraft,
              headRefName: raw.headRefName,
              baseRefName: raw.baseRefName,
              updatedAt: raw.updatedAt,
              checks: summarizeStatusCheckRollup(checkRollup(raw)),
            } satisfies GithubPr,
          ]
        : [],
    ),
  };
}

export function allowedMergeMethods(raw: GithubRepoRaw): GithubPrMergeMethod[] {
  const methods: GithubPrMergeMethod[] = [];
  if (raw.mergeCommitAllowed) methods.push("merge");
  if (raw.squashMergeAllowed) methods.push("squash");
  if (raw.rebaseMergeAllowed) methods.push("rebase");
  return methods;
}

function mapPrCore(raw: GithubPrDetailRaw): GithubPrCore {
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
    headRepository: raw.headRepository?.nameWithOwner ?? null,
    updatedAt: raw.updatedAt,
    createdAt: raw.createdAt,
    author: raw.author?.login ?? null,
    additions: raw.additions ?? 0,
    deletions: raw.deletions ?? 0,
    changedFiles: raw.changedFiles ?? 0,
  };
}

function compact<T>(values: Array<T | null> | null | undefined): T[] {
  return (values ?? []).filter((value): value is T => value !== null);
}

function mapPrConversation(raw: GithubPrDetailRaw): GithubPrConversation {
  return {
    body: raw.body ?? "",
    comments: compact(raw.comments?.nodes).map((comment, index) => ({
      id: String(comment.id ?? comment.databaseId ?? `comment-${index}`),
      author: comment.author?.login ?? null,
      authorAvatarUrl: comment.author?.avatarUrl,
      body: comment.body ?? "",
      createdAt: comment.createdAt ?? raw.createdAt,
      updatedAt: comment.updatedAt,
      url: comment.url,
    })),
    reviews: compact(raw.reviews?.nodes).map((review, index) => ({
      id: String(review.id ?? review.databaseId ?? `review-${index}`),
      author: review.author?.login ?? null,
      authorAvatarUrl: review.author?.avatarUrl,
      state: review.state ?? "COMMENTED",
      body: review.body ?? "",
      submittedAt: review.submittedAt ?? raw.updatedAt,
      url: review.url,
    })),
  };
}

function mapPrOverview(
  raw: GithubPrDetailRaw,
  settings: GithubRepoRaw,
  behindBy: number | null,
): GithubPrOverview {
  return {
    mergeable: raw.mergeable ?? null,
    mergeStateStatus: raw.mergeStateStatus ?? null,
    reviewDecision: raw.reviewDecision ?? null,
    behindBy,
    labels: compact(raw.labels?.nodes).flatMap((label) =>
      label.name ? [{ name: label.name, color: label.color }] : [],
    ),
    reviewRequests: compact(raw.reviewRequests?.nodes).flatMap((request) => {
      const reviewer = request.requestedReviewer;
      const login = reviewer?.login ?? reviewer?.slug;
      return login ? [{ login, avatarUrl: reviewer?.avatarUrl }] : [];
    }),
    mergeSettings: { allowedMethods: allowedMergeMethods(settings) },
  };
}

async function behindBy(
  context: GithubServiceContext,
  repository: GithubRepositoryRef,
  baseOid: string,
  headOid: string,
): Promise<number | null> {
  if (!baseOid || !headOid) return null;
  try {
    const result = await context.githubApi.rest<{ behind_by?: number }>(
      repository,
      `/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.repo)}/compare/${encodeURIComponent(baseOid)}...${encodeURIComponent(headOid)}`,
      { operation: "compare-pull-request" },
    );
    return Number.isInteger(result.behind_by) && (result.behind_by ?? -1) >= 0
      ? (result.behind_by ?? null)
      : null;
  } catch {
    return null;
  }
}

async function loadPr(
  context: GithubServiceContext,
  repository: GithubRepositoryRef,
  number: number,
  fields: string,
  operation: string,
  includeSettings = false,
): Promise<{ raw: GithubPrDetailRaw; settings: GithubRepoRaw }> {
  const data = await context.githubApi.graphql<RepositoryResponse>(
    repository,
    operation,
    repositoryQuery(fields, includeSettings),
    variables(repository, number),
  );
  const settings = requireRepository(data);
  return { raw: requirePr(settings), settings };
}

export async function prInitial(
  context: GithubServiceContext,
  projectId: string,
  relativePath: string,
  number: number,
): Promise<GithubPrInitial> {
  const { repository } = await preparePr(context, projectId, relativePath);
  const { raw, settings } = await loadPr(
    context,
    repository,
    number,
    `${CORE_FIELDS}${CONVERSATION_FIELDS}${OVERVIEW_FIELDS}`,
    "pull-request-initial",
    true,
  );
  const divergence = await behindBy(
    context,
    repository,
    raw.baseRefOid ?? "",
    raw.headRefOid ?? "",
  );
  return {
    core: mapPrCore(raw),
    conversation: mapPrConversation(raw),
    overview: mapPrOverview(raw, settings, divergence),
  };
}

export async function prCore(
  context: GithubServiceContext,
  projectId: string,
  relativePath: string,
  number: number,
): Promise<GithubPrCore> {
  const { repository } = await preparePr(context, projectId, relativePath);
  return mapPrCore(
    (
      await loadPr(
        context,
        repository,
        number,
        CORE_FIELDS,
        "pull-request-core",
      )
    ).raw,
  );
}

export async function prConversation(
  context: GithubServiceContext,
  projectId: string,
  relativePath: string,
  number: number,
): Promise<GithubPrConversation> {
  const { repository } = await preparePr(context, projectId, relativePath);
  return mapPrConversation(
    (
      await loadPr(
        context,
        repository,
        number,
        CONVERSATION_FIELDS,
        "pull-request-conversation",
      )
    ).raw,
  );
}

export async function prOverview(
  context: GithubServiceContext,
  projectId: string,
  relativePath: string,
  number: number,
): Promise<GithubPrOverview> {
  const { repository } = await preparePr(context, projectId, relativePath);
  const { raw, settings } = await loadPr(
    context,
    repository,
    number,
    OVERVIEW_FIELDS,
    "pull-request-overview",
    true,
  );
  return mapPrOverview(
    raw,
    settings,
    await behindBy(
      context,
      repository,
      raw.baseRefOid ?? "",
      raw.headRefOid ?? "",
    ),
  );
}

const COMMITS_FIELDS = `commits(first: 100) {
  nodes { commit { oid messageHeadline authoredDate authors(first: 1) { nodes { name } } } }
}`;

export async function prCommits(
  context: GithubServiceContext,
  projectId: string,
  relativePath: string,
  number: number,
): Promise<GithubPrCommitsResponse> {
  const { repository } = await preparePr(context, projectId, relativePath);
  const raw = (
    await loadPr(
      context,
      repository,
      number,
      COMMITS_FIELDS,
      "pull-request-commits",
    )
  ).raw;
  return {
    commits: compact(raw.commits?.nodes).flatMap((node) => {
      const commit = node.commit;
      return commit
        ? [
            {
              oid: commit.oid,
              abbrev: commit.oid.slice(0, 7),
              messageHeadline: commit.messageHeadline ?? "",
              authoredDate: commit.authoredDate,
              authorName: compact(commit.authors?.nodes)[0]?.name,
            },
          ]
        : [];
    }),
  };
}

export async function prChecks(
  context: GithubServiceContext,
  projectId: string,
  relativePath: string,
  number: number,
): Promise<GithubPrChecksResponse> {
  const { repository } = await preparePr(context, projectId, relativePath);
  const raw = (
    await loadPr(
      context,
      repository,
      number,
      CHECK_FIELDS,
      "pull-request-checks",
    )
  ).raw;
  return {
    checks: raw.commits
      ? summarizeStatusCheckRollup(checkRollup(raw))
      : noChecksSummary(),
  };
}

const MAX_PR_FILES = 300;
const PR_FILES_PER_PAGE = 100;
const MAX_PR_FILE_DOCUMENT_BYTES = 16 * 1024 * 1024;

type GithubPrFileRaw = {
  filename?: string;
  previous_filename?: string;
  status?: string;
  additions?: number;
  deletions?: number;
  changes?: number;
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
  const { repository } = await preparePr(context, projectId, relativePath);
  const root = `/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.repo)}/pulls/${number}`;
  const detailPromise = context.githubApi.rest<{ changed_files?: number }>(
    repository,
    root,
    { operation: "pull-request-file-count" },
  );
  const rawFiles: GithubPrFileRaw[] = [];
  for (let page = 1; page <= MAX_PR_FILES / PR_FILES_PER_PAGE; page += 1) {
    const pageFiles = await context.githubApi.rest<GithubPrFileRaw[]>(
      repository,
      `${root}/files?per_page=${PR_FILES_PER_PAGE}&page=${page}`,
      { operation: "pull-request-files" },
    );
    rawFiles.push(...pageFiles);
    if (pageFiles.length < PR_FILES_PER_PAGE) break;
  }
  const detail = await detailPromise;
  const totalCount = Number.isInteger(detail.changed_files)
    ? (detail.changed_files ?? rawFiles.length)
    : rawFiles.length;
  const files = rawFiles.slice(0, MAX_PR_FILES).flatMap((file) =>
    file.filename
      ? [
          {
            path: file.filename,
            previousPath: file.previous_filename,
            status: fileStatus(file.status),
            additions: file.additions ?? 0,
            deletions: file.deletions ?? 0,
            changes: file.changes ?? 0,
          },
        ]
      : [],
  );
  return {
    files,
    totalCount,
    truncated: totalCount > files.length,
  };
}

type GithubGraphqlBlobRaw = {
  byteSize?: number;
  isBinary?: boolean;
  isTruncated?: boolean;
  text?: string | null;
};

type GithubPrFileDiffGraphqlRaw = {
  repository?: {
    pullRequest?: {
      baseRefOid?: string;
      headRefOid?: string;
      headRepository?: { nameWithOwner?: string } | null;
    } | null;
    original?: GithubGraphqlBlobRaw | null;
  } | null;
  headRepository?: { modified?: GithubGraphqlBlobRaw | null } | null;
};

type PrFileDocument =
  | { kind: "text"; text: string }
  | { kind: "binary" }
  | {
      kind: "unavailable";
      reason: "content-too-large" | "content-unavailable";
    };

function graphqlPrFileDocument(
  raw: GithubGraphqlBlobRaw | null | undefined,
  required: boolean,
): PrFileDocument {
  if (!required) return { kind: "text", text: "" };
  if (!raw) return { kind: "unavailable", reason: "content-unavailable" };
  if (
    raw.isTruncated ||
    (typeof raw.byteSize === "number" &&
      raw.byteSize > MAX_PR_FILE_DOCUMENT_BYTES)
  )
    return { kind: "unavailable", reason: "content-too-large" };
  if (raw.isBinary || typeof raw.text !== "string" || raw.text.includes("\0"))
    return { kind: "binary" };
  return { kind: "text", text: raw.text };
}

function repositoryParts(
  nameWithOwner: string | undefined,
): { owner: string; repo: string } | undefined {
  const [owner, repo, ...rest] = nameWithOwner?.split("/") ?? [];
  return owner && repo && rest.length === 0 ? { owner, repo } : undefined;
}

const PR_FILE_DIFF_QUERY = `
  query PullRequestFileDiff(
    $owner: String!
    $repo: String!
    $number: Int!
    $headOwner: String!
    $headRepo: String!
    $originalExpression: String!
    $modifiedExpression: String!
    $loadOriginal: Boolean!
    $loadModified: Boolean!
  ) {
    repository(owner: $owner, name: $repo) {
      pullRequest(number: $number) {
        baseRefOid
        headRefOid
        headRepository { nameWithOwner }
      }
      original: object(expression: $originalExpression) @include(if: $loadOriginal) {
        ... on Blob { byteSize isBinary isTruncated text }
      }
    }
    headRepository: repository(owner: $headOwner, name: $headRepo)
      @include(if: $loadModified) {
      modified: object(expression: $modifiedExpression) {
        ... on Blob { byteSize isBinary isTruncated text }
      }
    }
  }
`;

export async function prFileDiff(
  context: GithubServiceContext,
  projectId: string,
  relativePath: string,
  number: number,
  input: Omit<GithubPrFileDiffRequest, "repo">,
): Promise<GithubPrFileDiffResponse> {
  const { repository } = await preparePr(context, projectId, relativePath);
  const metadata = {
    path: input.path,
    ...(input.previousPath ? { previousPath: input.previousPath } : {}),
    baseRefOid: input.expectedBaseRefOid,
    headRefOid: input.expectedHeadRefOid,
  };
  const needsOriginal = input.status !== "added";
  const needsModified = input.status !== "removed";
  const head = repositoryParts(input.expectedHeadRepository);
  if (needsModified && !head)
    return {
      ...metadata,
      kind: "unavailable",
      reason: "repository-unavailable",
    };
  const headRepository = head ?? {
    owner: repository.owner,
    repo: repository.repo,
  };
  const data = await context.githubApi.graphql<GithubPrFileDiffGraphqlRaw>(
    repository,
    "pull-request-file-diff",
    PR_FILE_DIFF_QUERY,
    {
      owner: repository.owner,
      repo: repository.repo,
      number,
      headOwner: headRepository.owner,
      headRepo: headRepository.repo,
      originalExpression: `${input.expectedBaseRefOid}:${input.previousPath ?? input.path}`,
      modifiedExpression: `${input.expectedHeadRefOid}:${input.path}`,
      loadOriginal: needsOriginal,
      loadModified: needsModified,
    },
  );
  const pull = data.repository?.pullRequest;
  if (!pull)
    return {
      ...metadata,
      kind: "unavailable",
      reason: "repository-unavailable",
    };
  if (
    pull.baseRefOid !== input.expectedBaseRefOid ||
    pull.headRefOid !== input.expectedHeadRefOid
  )
    throw new GitWorkflowError(
      409,
      "GH_PR_UPDATED",
      "The pull request changed. Refresh it before loading this file.",
    );
  if (
    needsModified &&
    pull.headRepository?.nameWithOwner !== input.expectedHeadRepository
  )
    throw new GitWorkflowError(
      409,
      "GH_PR_UPDATED",
      "The pull request source changed. Refresh it before loading this file.",
    );
  if (needsModified && !data.headRepository)
    return {
      ...metadata,
      kind: "unavailable",
      reason: "repository-unavailable",
    };

  const original = graphqlPrFileDocument(
    data.repository?.original,
    needsOriginal,
  );
  const modified = graphqlPrFileDocument(
    data.headRepository?.modified,
    needsModified,
  );
  if (original.kind === "binary" || modified.kind === "binary")
    return { ...metadata, kind: "binary" };
  if (original.kind === "unavailable") return { ...metadata, ...original };
  if (modified.kind === "unavailable") return { ...metadata, ...modified };
  return {
    ...metadata,
    kind: "text",
    original: original.text,
    modified: modified.text,
  };
}

export async function mergePr(
  context: GithubServiceContext,
  projectId: string,
  relativePath: string,
  number: number,
  method: GithubPrMergeMethod,
  expectedHeadOid: string,
): Promise<GithubPrMergeResponse> {
  const { repoDir, repository } = await preparePr(
    context,
    projectId,
    relativePath,
  );
  const settingsData = await context.githubApi.graphql<RepositoryResponse>(
    repository,
    "pull-request-merge-settings",
    `query MergeSettings($owner: String!, $repo: String!) {
      repository(owner: $owner, name: $repo) { ${REPOSITORY_SETTINGS_FIELDS} }
    }`,
    { owner: repository.owner, repo: repository.repo },
  );
  const settings = requireRepository(settingsData);
  if (!allowedMergeMethods(settings).includes(method))
    throw new GitWorkflowError(
      409,
      "GH_PR_MERGE_METHOD_DISABLED",
      `The repository does not allow the ${method} merge method.`,
    );
  const result = await context.githubApi.rest<{ merged?: boolean }>(
    repository,
    `/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.repo)}/pulls/${number}/merge`,
    {
      method: "PUT",
      operation: "merge-pull-request",
      body: { merge_method: method, sha: expectedHeadOid },
    },
  );
  if (!result.merged)
    throw new GitWorkflowError(
      409,
      "GH_CONFLICT",
      "GitHub could not merge the pull request.",
    );
  context.invalidateStableMetadata(repoDir);
  return {
    number,
    merged: true,
    url: `https://github.com/${repository.owner}/${repository.repo}/pull/${number}`,
  };
}

function selectRepositoryRemote(
  snapshot: GitReadSnapshot,
  repository: Pick<GithubRepositoryRef, "owner" | "repo">,
): string | null {
  const matches = snapshot.remotes.filter((remote) => {
    const parsed = parseGithubRepositoryUrl(
      remote.fetchUrl ?? remote.pushUrl ?? "",
    );
    return (
      parsed?.owner.toLowerCase() === repository.owner.toLowerCase() &&
      parsed.repo.toLowerCase() === repository.repo.toLowerCase()
    );
  });
  return (
    matches.find((remote) => remote.name === "origin")?.name ??
    matches[0]?.name ??
    null
  );
}

export async function checkoutPr(
  context: GithubServiceContext,
  projectId: string,
  relativePath: string,
  number: number,
): Promise<GithubPrCheckoutResponse> {
  const { repoDir, repository } = await preparePr(
    context,
    projectId,
    relativePath,
  );
  const initial = await context.readSnapshot(repoDir);
  if (initial.files.length > 0)
    throw new GitWorkflowError(
      409,
      "GIT_DIRTY_WORKTREE",
      "Working tree has uncommitted changes. Commit or stash them before checking out a PR.",
    );
  const { raw } = await loadPr(
    context,
    repository,
    number,
    "headRefName headRefOid headRepository { nameWithOwner }",
    "checkout-pull-request",
  );
  if (!raw.headRefName || !raw.headRefOid)
    throw new GitWorkflowError(
      409,
      "GH_PR_SOURCE_UNAVAILABLE",
      "The pull request source revision is unavailable.",
    );
  const remote = selectRepositoryRemote(initial, repository);
  if (!remote)
    throw new GitWorkflowError(
      409,
      "GH_NO_GITHUB_REMOTE",
      "No local remote matches this GitHub repository.",
    );
  const pullRef = `refs/remotes/${remote}/pull/${number}`;
  await context.mapGit(() =>
    context.runGit(repoDir, [
      "fetch",
      "--no-tags",
      remote,
      `+refs/pull/${number}/head:${pullRef}`,
    ]),
  );
  const fetchedOid = await context.resolveRevision(repoDir, pullRef);
  if (fetchedOid !== raw.headRefOid)
    throw new GitWorkflowError(
      409,
      "GH_PR_HEAD_CHANGED",
      "The pull request head changed while it was being fetched. Try again.",
    );

  const refreshed = await context.readSnapshot(repoDir);
  const localRef = `refs/heads/${raw.headRefName}`;
  const localOid = refreshed.refs.find((ref) => ref.name === localRef)?.target;
  const [headOwner, headRepo] =
    raw.headRepository?.nameWithOwner?.split("/") ?? [];
  const canonicalRemote =
    headOwner && headRepo
      ? selectRepositoryRemote(refreshed, {
          owner: headOwner,
          repo: headRepo,
        })
      : remote;
  const canonicalRef = `refs/remotes/${canonicalRemote ?? remote}/${raw.headRefName}`;
  const canonicalMatches = refreshed.refs.some(
    (ref) => ref.name === canonicalRef && ref.target === fetchedOid,
  );
  const checkoutTarget = canonicalMatches ? canonicalRef : pullRef;
  if (!localOid) {
    await context.mapGit(() =>
      context.runGit(repoDir, [
        "switch",
        "-c",
        raw.headRefName,
        checkoutTarget,
      ]),
    );
  } else if (localOid === fetchedOid) {
    await context.mapGit(() =>
      context.runGit(repoDir, ["switch", raw.headRefName]),
    );
  } else if (await context.isAncestor(repoDir, localOid, fetchedOid)) {
    await context.mapGit(() =>
      context.runGit(repoDir, ["switch", raw.headRefName]),
    );
    await context.mapGit(() =>
      context.runGit(repoDir, ["merge", "--ff-only", checkoutTarget]),
    );
  } else {
    throw new GitWorkflowError(
      409,
      "GIT_BRANCH_DIVERGED",
      `Local branch '${raw.headRefName}' has diverged from the pull request head.`,
    );
  }
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
