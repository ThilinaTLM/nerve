import type { RestCheckRun, RestCommitStatus } from "./git-github-checks.js";
import { GitWorkflowError } from "./git-errors.js";
import type { GithubPr } from "@nervekit/contracts/git";
import { summarizeStatusCheckRollup } from "./git-github-parsers.js";
import {
  CHECK_FIELDS,
  CORE_FIELDS,
  preparePr,
  type GithubPrDetailRaw,
  type GithubServiceContext,
} from "./git-github-service.js";

export type PullProbeRow = {
  number: number;
  updated_at: string;
  state: string;
  head: { ref: string; sha: string };
};
const SUMMARY_FIELDS = `${CORE_FIELDS} ${CHECK_FIELDS}
 labels(first: 100) { nodes { name color } }
 reviewRequests(first: 100) { nodes { requestedReviewer { ... on User { login } } } }`;

function summary(raw: GithubPrDetailRaw, viewer: string | null): GithubPr {
  return {
    number: raw.number,
    title: raw.title,
    url: raw.url,
    state: raw.state,
    isDraft: raw.isDraft,
    headRefName: raw.headRefName,
    baseRefName: raw.baseRefName,
    headSha: raw.headRefOid ?? "",
    headRepository: raw.headRepository?.nameWithOwner ?? null,
    updatedAt: raw.updatedAt,
    author: raw.author?.login ?? null,
    additions: raw.additions ?? 0,
    deletions: raw.deletions ?? 0,
    commentCount: raw.commentCount?.totalCount ?? 0,
    labels: (raw.labels?.nodes ?? []).flatMap((label) =>
      label ? [label.name ?? ""] : [],
    ),
    reviewRequested:
      !!viewer &&
      !!raw.reviewRequests?.nodes?.some(
        (request) => request?.requestedReviewer?.login === viewer,
      ),
    checks: summarizeStatusCheckRollup(
      raw.commits?.nodes?.[0]?.commit?.statusCheckRollup?.contexts?.nodes,
    ),
  };
}

export async function fetchPrSummaries(
  context: GithubServiceContext,
  projectId: string,
  repo: string,
  numbers?: number[],
  branches: string[] = [],
  signal?: AbortSignal,
) {
  const { repository } = await preparePr(context, projectId, repo);
  const fields = numbers
    ? numbers
        .map(
          (number) =>
            `pr${number}: pullRequest(number: ${number}) { ${SUMMARY_FIELDS} }`,
        )
        .join("\n")
    : `pullRequests(states: OPEN, first: 100, orderBy: {field: UPDATED_AT, direction: DESC}) { totalCount nodes { ${SUMMARY_FIELDS} } }`;
  const branchFields = branches
    .map(
      (branch, index) =>
        `branch${index}: pullRequests(headRefName: ${JSON.stringify(branch)}, first: 1, orderBy: {field: UPDATED_AT, direction: DESC}) { nodes { ${SUMMARY_FIELDS} } }`,
    )
    .join("\n");
  const data = await context.githubApi.graphql<{
    viewer: { login: string };
    repository: Record<
      string,
      | GithubPrDetailRaw
      | { totalCount?: number; nodes?: GithubPrDetailRaw[] }
      | null
    >;
  }>(
    repository,
    "sync-pull-requests",
    `query($owner: String!, $repo: String!) { viewer { login } repository(owner: $owner, name: $repo) { ${fields} ${branchFields} } }`,
    { owner: repository.owner, repo: repository.repo },
    signal,
  );
  const viewer = data.viewer.login;
  const connection = data.repository.pullRequests as
    | { totalCount?: number; nodes?: GithubPrDetailRaw[] }
    | undefined;
  const raw = numbers
    ? numbers.flatMap((number) => {
        const pr = data.repository[`pr${number}`] as GithubPrDetailRaw | null;
        return pr ? [pr] : [];
      })
    : (connection?.nodes ?? []);
  for (let index = 0; index < branches.length; index++)
    raw.push(
      ...((
        data.repository[`branch${index}`] as {
          nodes?: GithubPrDetailRaw[];
        } | null
      )?.nodes ?? []),
    );
  return {
    prs: raw.map((pr) => summary(pr, viewer)),
    viewer,
    truncated: (connection?.totalCount ?? 0) > 100,
  };
}

export async function probePullRequests(
  context: GithubServiceContext,
  projectId: string,
  repo: string,
  etag?: string,
  signal?: AbortSignal,
) {
  const { repository } = await preparePr(context, projectId, repo);
  return context.githubApi.probe<PullProbeRow[]>(
    repository,
    `/repos/${repository.owner}/${repository.repo}/pulls?state=all&sort=updated&direction=desc&per_page=30`,
    etag,
    signal,
  );
}

export async function probePrChecks(
  context: GithubServiceContext,
  projectId: string,
  repo: string,
  sha: string,
  etags: { runs?: string; status?: string },
  signal?: AbortSignal,
) {
  const { repository } = await preparePr(context, projectId, repo);
  const path = `/repos/${repository.owner}/${repository.repo}/commits/${encodeURIComponent(sha)}`;
  const runs = await context.githubApi.probe<{ check_runs: RestCheckRun[] }>(
    repository,
    `${path}/check-runs?per_page=100`,
    etags.runs,
    signal,
  );
  const status = await context.githubApi.probe<RestCommitStatus>(
    repository,
    `${path}/status`,
    etags.status,
    signal,
  );
  return { runs, status };
}

/** Local remote + cached gh token admission; never spends an API request on /user. */
export async function prSyncAvailability(
  context: GithubServiceContext,
  projectId: string,
  repo: string,
  signal?: AbortSignal,
): Promise<{
  status: "ready" | "unavailable" | "unauthenticated";
  repositoryUrl: string | null;
}> {
  const state = await context.repoRemoteState(
    context.resolveRepoDir(projectId, repo),
  );
  if (!state.githubRepository)
    return { status: "unavailable", repositoryUrl: null };
  const repositoryUrl = `https://${state.githubRepository.hostname}/${state.githubRepository.owner}/${state.githubRepository.repo}`;
  try {
    await context.githubApi.authenticate(
      state.githubRepository.hostname,
      signal,
    );
    return { status: "ready", repositoryUrl };
  } catch (error) {
    if (signal?.aborted) throw signal.reason;
    return {
      repositoryUrl,
      status:
        error instanceof GitWorkflowError && error.code === "GH_CLI_UNAVAILABLE"
          ? "unavailable"
          : "unauthenticated",
    };
  }
}
