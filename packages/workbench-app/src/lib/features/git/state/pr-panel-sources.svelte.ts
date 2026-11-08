import type { GitRepoSummary } from "@nervekit/contracts/git";
import {
  groupGithubCheckouts,
  type GitPrCheckoutGroup,
  type GitPrRepositorySource,
} from "../pr-filters";
import {
  repoPrRepositoryUrl,
  repoPrSnapshot,
  repoPrStatus,
} from "./pr-store.svelte";

/** GitHub repositories of the project, one group per `owner/name`. */
export function githubCheckoutGroups(
  projectId: string,
  repos: readonly GitRepoSummary[],
): GitPrCheckoutGroup[] {
  const github = repos.filter((repo) => repo.hasGithubRemote);
  const names = Object.fromEntries(
    github.map((repo) => [repo.relativePath, repo.name]),
  );
  return groupGithubCheckouts(
    github.map((repo) => ({
      relativePath: repo.relativePath,
      currentBranch: repo.currentBranch,
      repositoryUrl: repoPrRepositoryUrl(projectId, repo.relativePath),
    })),
    (path) => names[path] ?? path,
  );
}

export type GitPullRequestsOverview = {
  /** GitHub repositories of the project (deduplicated by remote). */
  readonly repositoryCount: number;
  readonly sources: readonly (GitPrRepositorySource & {
    readonly truncated: boolean;
  })[];
  /** `loading` until a snapshot answered; `unavailable` means gh is missing. */
  readonly status: "loading" | "ready" | "unavailable" | "unauthenticated";
  readonly viewer: string | null;
  readonly loading: boolean;
  readonly refreshing: boolean;
  readonly notice?: string;
};

function notice(status: string, error?: string): string | undefined {
  if (status === "rate_limited")
    return "Pull request updates are paused by GitHub’s rate limit.";
  if (status === "unavailable") return "Pull request updates are unavailable.";
  if (error) return error;
  return status === "error"
    ? "Pull request updates are temporarily unavailable."
    : undefined;
}

export function pullRequestsOverview(
  projectId: string,
  repos: readonly GitRepoSummary[],
): GitPullRequestsOverview {
  const groups = githubCheckoutGroups(projectId, repos);
  const sources: GitPullRequestsOverview["sources"][number][] = [];
  let anySnapshot = false;
  let unavailable = false;
  let unauthenticated = false;
  let loading = false;
  let refreshing = false;
  let message: string | undefined;
  let viewer: string | null = null;
  for (const group of groups) {
    const snapshot = repoPrSnapshot(projectId, group.repository);
    const status = repoPrStatus(projectId, group.repository);
    loading ||= status.loading;
    refreshing ||= status.refreshing;
    if (!snapshot) {
      message ??= status.error;
      continue;
    }
    anySnapshot = true;
    viewer ??= snapshot.viewer;
    if (snapshot.status === "unavailable") unavailable = true;
    else if (snapshot.status === "unauthenticated") unauthenticated = true;
    else message ??= notice(snapshot.status, status.error);
    sources.push({
      key: group.key,
      name: group.name,
      repository: group.repository,
      prs: snapshot.prs,
      viewer: snapshot.viewer,
      checkedOutBranches: group.checkedOutBranches,
      truncated: snapshot.truncated,
    });
  }
  return {
    repositoryCount: groups.length,
    sources,
    status: unavailable
      ? "unavailable"
      : unauthenticated
        ? "unauthenticated"
        : anySnapshot
          ? "ready"
          : "loading",
    viewer,
    loading,
    refreshing,
    notice: message,
  };
}
