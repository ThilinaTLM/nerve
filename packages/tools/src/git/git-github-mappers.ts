import type {
  GithubPr,
  GithubPrCommitsResponse,
  GithubPrConversation,
  GithubPrCore,
  GithubPrFile,
  GithubPrMergeMethod,
  GithubPrOverview,
} from "@nervekit/contracts/git";
import { summarizeStatusCheckRollup } from "./git-github-parsers.js";
import type { GithubPrDetailRaw, GithubRepoRaw } from "./git-github-queries.js";

const MAX_PR_FILE_DOCUMENT_BYTES = 16 * 1024 * 1024;

export function checkRollup(raw: GithubPrDetailRaw): readonly unknown[] | null {
  return (
    raw.commits?.nodes?.[0]?.commit?.statusCheckRollup?.contexts?.nodes ?? null
  );
}

export function allowedMergeMethods(raw: GithubRepoRaw): GithubPrMergeMethod[] {
  const methods: GithubPrMergeMethod[] = [];
  if (raw.mergeCommitAllowed) methods.push("merge");
  if (raw.squashMergeAllowed) methods.push("squash");
  if (raw.rebaseMergeAllowed) methods.push("rebase");
  return methods;
}

export function mapPrCore(raw: GithubPrDetailRaw): GithubPrCore {
  return {
    number: raw.number,
    title: raw.title,
    url: raw.url,
    state: raw.state,
    isDraft: raw.isDraft,
    headRefName: raw.headRefName,
    baseRefName: raw.baseRefName,
    headSha: raw.headRefOid ?? "",
    headRefOid: raw.headRefOid ?? "",
    baseRefOid: raw.baseRefOid ?? "",
    headRepository: raw.headRepository?.nameWithOwner ?? null,
    updatedAt: raw.updatedAt,
    createdAt: raw.createdAt,
    author: raw.author?.login ?? null,
    commentCount: raw.commentCount?.totalCount ?? 0,
    additions: raw.additions ?? 0,
    deletions: raw.deletions ?? 0,
    changedFiles: raw.changedFiles ?? 0,
  };
}

export function compact<T>(values: Array<T | null> | null | undefined): T[] {
  return (values ?? []).filter((value): value is T => value !== null);
}

export function mapPrConversation(
  raw: GithubPrDetailRaw,
): GithubPrConversation {
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

export function mapPrOverview(
  raw: GithubPrDetailRaw,
  settings: GithubRepoRaw,
  behindBy: number | null,
): GithubPrOverview {
  return {
    mergeable: raw.mergeable ?? null,
    mergeStateStatus: raw.mergeStateStatus ?? null,
    reviewDecision: raw.reviewDecision ?? null,
    viewerCanMergeAsAdmin: raw.viewerCanMergeAsAdmin ?? false,
    behindBy,
    mergedAt: raw.mergedAt ?? null,
    mergedBy: raw.mergedBy?.login ?? null,
    mergeCommitOid:
      raw.mergeCommit?.abbreviatedOid ?? raw.mergeCommit?.oid ?? null,
    closedAt: raw.closedAt ?? null,
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

export type GithubPrFileRaw = {
  filename?: string;
  previous_filename?: string;
  status?: string;
  additions?: number;
  deletions?: number;
  changes?: number;
};

export function fileStatus(value?: string): GithubPrFile["status"] {
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

export type GithubGraphqlBlobRaw = {
  byteSize?: number;
  isBinary?: boolean;
  isTruncated?: boolean;
  text?: string | null;
};

export type GithubPrFileDiffGraphqlRaw = {
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

export type PrFileDocument =
  | { kind: "text"; text: string }
  | { kind: "binary" }
  | {
      kind: "unavailable";
      reason: "content-too-large" | "content-unavailable";
    };

export function graphqlPrFileDocument(
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

export function repositoryParts(
  nameWithOwner: string | undefined,
): { owner: string; repo: string } | undefined {
  const [owner, repo, ...rest] = nameWithOwner?.split("/") ?? [];
  return owner && repo && rest.length === 0 ? { owner, repo } : undefined;
}

/** Maps one GraphQL search node to a pull-request list row. */
export function mapPrListItem(
  raw: GithubPrDetailRaw,
  viewerLogin: string | undefined,
): GithubPr {
  return {
    number: raw.number,
    title: raw.title,
    url: raw.url,
    state: raw.state,
    isDraft: raw.isDraft,
    headRefName: raw.headRefName,
    baseRefName: raw.baseRefName,
    updatedAt: raw.updatedAt,
    author: raw.author?.login ?? null,
    commentCount: raw.commentCount?.totalCount ?? 0,
    additions: raw.additions ?? 0,
    deletions: raw.deletions ?? 0,
    headSha: raw.headRefOid ?? "",
    headRepository: raw.headRepository?.nameWithOwner ?? null,
    labels: compact(raw.labels?.nodes).map((label) => label.name ?? ""),
    reviewRequested:
      !!viewerLogin &&
      !!raw.reviewRequests?.nodes?.some(
        (request) => request?.requestedReviewer?.login === viewerLogin,
      ),
    checks: summarizeStatusCheckRollup(checkRollup(raw)),
  };
}

export function mapPrCommits(raw: GithubPrDetailRaw): GithubPrCommitsResponse {
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
              authorLogin: commit.author?.user?.login,
              additions: commit.additions,
              deletions: commit.deletions,
            },
          ]
        : [];
    }),
  };
}

/** Maps REST pull-request files, keeping at most `limit` of them. */
export function mapPrFiles(
  rawFiles: readonly GithubPrFileRaw[],
  limit: number,
): GithubPrFile[] {
  return rawFiles.slice(0, limit).flatMap((file) =>
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
}
