import type { GithubPrListFilters } from "@nervekit/contracts/git";
import { selection } from "$lib/application/workspace/selection.svelte";
import {
  gitProjectStateKey,
  gitRepoStateKey,
} from "$lib/domain/navigation/view-keys";
import { queryClient, queryKeys } from "$lib/platform/query/client";
import { getGithubStatus, listGithubPrs } from "../api/git.api";
import {
  currentBranchPrHead,
  resolveCurrentBranchPr,
} from "./git-current-branch-pr";
import {
  ensureGitRepoState,
  gitPanelState,
  setGithubStatusIfChanged,
  type GitPanelRepoState,
} from "./git-panel-state.svelte";
import {
  GITHUB_STATUS_STALE_MS,
  GIT_STALE_MS,
  githubPrFiltersFingerprint,
} from "./git-refresh-policy";

export function projectGithubAuthenticated(projectId: string): boolean {
  const project = gitPanelState.projects[gitProjectStateKey(projectId)];
  const repo =
    project?.repos.find(
      (repo) =>
        repo.relativePath === project.selectedRepo && repo.hasGithubRemote,
    ) ?? project?.repos.find((repo) => repo.hasGithubRemote);
  return Boolean(
    repo &&
    project?.repoStates[gitRepoStateKey(repo.relativePath)]?.github
      ?.authenticated,
  );
}

/** One cached authentication probe, even when the selected repo has no GitHub remote. */
export async function refreshPrHeadsAuthentication(
  projectId: string,
  repo: string,
  isCurrent: () => boolean,
): Promise<boolean> {
  try {
    const status = await queryClient.fetchQuery({
      queryKey: queryKeys.git.githubStatus(projectId, repo),
      queryFn: () => getGithubStatus(projectId, repo),
      staleTime: ensureGitRepoState(projectId, repo).github?.authenticated
        ? GITHUB_STATUS_STALE_MS
        : GIT_STALE_MS,
      retry: false,
    });
    if (!isCurrent()) return false;
    setGithubStatusIfChanged(ensureGitRepoState(projectId, repo), status);
    return status.authenticated;
  } catch {
    return false;
  }
}

export function branchPrFilters(branch: string): GithubPrListFilters {
  return {
    author: "any",
    reviewRequested: false,
    drafts: "include",
    title: "",
    head: branch,
    labels: [],
    sort: "updated-desc",
  };
}

const branchPrRequests = new WeakMap<GitPanelRepoState, object>();

export async function refreshCurrentBranchPr(
  projectId: string,
  repo: string,
): Promise<void> {
  const state = ensureGitRepoState(projectId, repo);
  const request = {};
  branchPrRequests.set(state, request);
  const branch = state.repoSummary?.currentBranch ?? undefined;
  const head = currentBranchPrHead(branch, state.prHeads?.prs ?? []);
  if (!head || !branch || !projectGithubAuthenticated(projectId)) {
    state.currentBranchPr = undefined;
    return;
  }
  const isCurrent = () =>
    branchPrRequests.get(state) === request &&
    selection.projectId === projectId &&
    state.repoSummary?.currentBranch === branch &&
    currentBranchPrHead(branch, state.prHeads?.prs ?? [])?.number ===
      head.number;
  try {
    const filters = branchPrFilters(branch);
    const pr = await resolveCurrentBranchPr(head, state.prs, async () => {
      const result = await queryClient.fetchQuery({
        queryKey: queryKeys.git.prs(
          projectId,
          repo,
          githubPrFiltersFingerprint(filters),
        ),
        queryFn: () => listGithubPrs(projectId, repo, filters),
        staleTime: GIT_STALE_MS,
        retry: false,
      });
      return result.prs;
    });
    if (isCurrent()) state.currentBranchPr = pr;
  } catch {
    // The changes card is optional enrichment too.
  }
}
