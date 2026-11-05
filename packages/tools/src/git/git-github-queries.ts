import type { GithubPrListFilters } from "@nervekit/contracts/git";
import type { GithubRepositoryRef } from "./git-github-parsers.js";

export type GithubAuthorRaw = { login?: string; avatarUrl?: string } | null;

export type GithubCheckRollupRaw = {
  contexts?: { nodes?: unknown[] | null } | null;
} | null;

export type GithubCommitNodeRaw = {
  oid: string;
  additions?: number;
  deletions?: number;
  author?: { user?: { login?: string } | null } | null;
  messageHeadline?: string;
  authoredDate?: string;
  authors?: { nodes?: Array<{ name?: string } | null> | null } | null;
  statusCheckRollup?: GithubCheckRollupRaw;
};

export type GithubPrDetailRaw = {
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
  viewerCanMergeAsAdmin?: boolean | null;
  mergedAt?: string | null;
  closedAt?: string | null;
  mergedBy?: { login?: string } | null;
  mergeCommit?: { abbreviatedOid?: string; oid?: string } | null;
  /* Aliased so the count can coexist with the conversation's comment nodes. */
  commentCount?: { totalCount?: number } | null;
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

export type GithubRepoRaw = {
  mergeCommitAllowed?: boolean;
  squashMergeAllowed?: boolean;
  rebaseMergeAllowed?: boolean;
  pullRequest?: GithubPrDetailRaw | null;
};

export type RepositoryResponse = { repository?: GithubRepoRaw | null };

export const CORE_FIELDS = `
  number title url state isDraft headRefName baseRefName headRefOid baseRefOid
  headRepository { nameWithOwner }
  updatedAt createdAt additions deletions changedFiles
  commentCount: comments { totalCount }
  author { login avatarUrl }
`;

export const CONVERSATION_FIELDS = `
  body createdAt updatedAt
  comments(first: 100) {
    nodes { id databaseId body createdAt updatedAt url author { login avatarUrl } }
  }
  reviews(first: 100) {
    nodes { id databaseId state body submittedAt url author { login avatarUrl } }
  }
`;

export const OVERVIEW_FIELDS = `
  headRefOid baseRefOid mergeable mergeStateStatus reviewDecision
  viewerCanMergeAsAdmin
  mergedAt closedAt mergedBy { login } mergeCommit { oid abbreviatedOid }
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

export const CHECK_FIELDS = `
  commits(last: 1) {
    nodes {
      commit {
        statusCheckRollup {
          contexts(first: 100) {
            nodes {
              __typename
              ... on CheckRun { name status conclusion detailsUrl startedAt completedAt checkSuite { app { name } } }
              ... on StatusContext { context state targetUrl }
            }
          }
        }
      }
    }
  }
`;

export const REPOSITORY_SETTINGS_FIELDS = `
  mergeCommitAllowed squashMergeAllowed rebaseMergeAllowed
`;

export function repositoryQuery(
  fields: string,
  includeSettings = false,
): string {
  return `query PullRequest($owner: String!, $repo: String!, $number: Int!) {
    repository(owner: $owner, name: $repo) {
      ${includeSettings ? REPOSITORY_SETTINGS_FIELDS : ""}
      pullRequest(number: $number) { ${fields} }
    }
  }`;
}

export function variables(repository: GithubRepositoryRef, number: number) {
  return { owner: repository.owner, repo: repository.repo, number };
}

export function quoteSearchValue(value: string): string {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

export function githubPrSearch(filters: GithubPrListFilters): string {
  const search = ["is:pr", "is:open"];
  if (filters.author === "me") search.push("author:@me");
  if (filters.author === "username" && filters.username)
    search.push(`author:${quoteSearchValue(filters.username)}`);
  if (filters.reviewRequested) search.push("review-requested:@me");
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

export const PR_LIST_QUERY = `query PullRequests($query: String!) {
  viewer { login }
  search(query: $query, type: ISSUE, first: 10) {
    nodes {
      ... on PullRequest {
        number title url state isDraft headRefName baseRefName headRefOid headRepository { nameWithOwner } labels(first: 100) { nodes { name color } } reviewRequests(first: 100) { nodes { requestedReviewer { ... on User { login } } } } updatedAt
        additions deletions author { login }
        commentCount: comments { totalCount }
        ${CHECK_FIELDS}
      }
    }
  }
}`;

export const COMMITS_FIELDS = `commits(first: 100) {
  nodes { commit { oid messageHeadline authoredDate additions deletions author { user { login } } authors(first: 1) { nodes { name } } } }
}`;

export const PR_FILE_DIFF_QUERY = `
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
