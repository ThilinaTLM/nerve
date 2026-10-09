import type {
  GitBranchListResponse,
  GitDiffArea,
  GitDiscoveryResponse,
  GitFileDiffResponse,
  GithubPrCheckoutResponse,
  GithubPrChecksResponse,
  GithubPrCommitsResponse,
  GithubPrConversation,
  GithubPrCore,
  GithubPrFileDiffResponse,
  GithubPrFileStatus,
  GithubPrFilesResponse,
  GithubPrHeadsResponse,
  GithubPrInitial,
  GithubPrListFilters,
  GithubPrListResponse,
  GithubPrMergeMethod,
  GithubPrMergeResponse,
  GithubPrOverview,
  GithubStatusResponse,
  GitMutationResponse,
  GitOverviewResponse,
  GitProjectFileStatusResponse,
  GitStashArea,
} from "@nervekit/contracts/git";
import { requestWorkbench } from "$lib/application/startup/workbench-connection";
import { workspaceMonitorDemand } from "$lib/application/monitoring/workspace-monitor-demand";

export async function discoverGitRepos(
  projectId: string,
): Promise<GitDiscoveryResponse> {
  return await requestWorkbench("git.repos.discover", {
    projectId,
  });
}

export function syncGitRepositoryMonitor(
  projectId: string,
  repo: string,
  active: boolean,
): Promise<void> {
  return workspaceMonitorDemand.syncRepository(projectId, repo, active);
}

export function clearGitRepositoryMonitor(
  projectId: string,
  repo: string,
): Promise<void> {
  return workspaceMonitorDemand.clearRepository(projectId, repo);
}

/** Re-scan the repository monitor after this client's own sync for it lands. */
export function requestGitRepositoryRefresh(
  projectId: string,
  repo: string,
): Promise<boolean> {
  return workspaceMonitorDemand.refreshRepository(projectId, repo);
}

export async function getGitOverview(
  projectId: string,
  repo: string,
): Promise<GitOverviewResponse> {
  return await requestWorkbench("git.overview.get", {
    projectId,
    repo,
  });
}

export async function getProjectGitFileStatus(
  projectId: string,
): Promise<GitProjectFileStatusResponse> {
  return await requestWorkbench("git.project.files.status.get", { projectId });
}

export async function listGitBranches(
  projectId: string,
  repo: string,
): Promise<GitBranchListResponse> {
  return await requestWorkbench("git.branches.list", {
    projectId,
    repo,
  });
}

export async function createGitBranch(
  projectId: string,
  repo: string,
  name: string,
): Promise<GitMutationResponse> {
  return await requestWorkbench("git.branch.create", {
    projectId,
    repo,
    name,
  });
}

export async function switchGitBranch(
  projectId: string,
  repo: string,
  name: string,
): Promise<GitMutationResponse> {
  return await requestWorkbench("git.branch.switch", {
    projectId,
    repo,
    name,
  });
}

export async function deleteGitBranch(
  projectId: string,
  repo: string,
  name: string,
): Promise<GitMutationResponse> {
  return await requestWorkbench("git.branch.delete", {
    projectId,
    repo,
    name,
  });
}

export async function syncGitBranch(
  projectId: string,
  repo: string,
): Promise<GitMutationResponse> {
  return await requestWorkbench("git.sync", { projectId, repo });
}

export async function pushGit(
  projectId: string,
  repo: string,
): Promise<GitMutationResponse> {
  return await requestWorkbench("git.push", { projectId, repo });
}

export async function pullGit(
  projectId: string,
  repo: string,
): Promise<GitMutationResponse> {
  return await requestWorkbench("git.pull", { projectId, repo });
}

export async function fetchGit(
  projectId: string,
  repo: string,
): Promise<GitMutationResponse> {
  return await requestWorkbench("git.fetch", { projectId, repo });
}

export async function switchBaseAndPullGit(
  projectId: string,
  repo: string,
  baseBranch?: string,
): Promise<GitMutationResponse> {
  return await requestWorkbench("git.switchBaseAndPull", {
    projectId,
    repo,
    baseBranch,
  });
}

export async function createGitStash(
  projectId: string,
  repo: string,
  area: GitStashArea,
  paths?: readonly string[],
): Promise<GitMutationResponse> {
  return await requestWorkbench("git.stash.create", {
    projectId,
    repo,
    area,
    ...(paths ? { paths: [...paths] } : {}),
  });
}

export async function applyGitStash(
  projectId: string,
  repo: string,
  index: number,
  expectedHash: string,
): Promise<GitMutationResponse> {
  return await requestWorkbench("git.stash.apply", {
    projectId,
    repo,
    index,
    expectedHash,
  });
}

export async function dropGitStash(
  projectId: string,
  repo: string,
  index: number,
  expectedHash: string,
): Promise<GitMutationResponse> {
  return await requestWorkbench("git.stash.drop", {
    projectId,
    repo,
    index,
    expectedHash,
  });
}

export async function getGitFileDiff(
  projectId: string,
  repo: string,
  path: string,
  area: GitDiffArea,
): Promise<GitFileDiffResponse> {
  return await requestWorkbench("git.file.diff.get", {
    projectId,
    repo,
    path,
    area,
  });
}

export async function stageGitFile(
  projectId: string,
  repo: string,
  path: string,
): Promise<GitMutationResponse> {
  return await requestWorkbench("git.file.stage", {
    projectId,
    repo,
    path,
  });
}

export async function unstageGitFile(
  projectId: string,
  repo: string,
  path: string,
): Promise<GitMutationResponse> {
  return await requestWorkbench("git.file.unstage", {
    projectId,
    repo,
    path,
  });
}

export async function discardGitFile(
  projectId: string,
  repo: string,
  path: string,
): Promise<GitMutationResponse> {
  return await requestWorkbench("git.file.discard", {
    projectId,
    repo,
    path,
  });
}

export async function getGithubStatus(
  projectId: string,
  repo: string,
): Promise<GithubStatusResponse> {
  return await requestWorkbench("github.status.get", {
    projectId,
    repo,
  });
}

export async function listGithubPrHeads(
  projectId: string,
  repo: string,
): Promise<GithubPrHeadsResponse> {
  return await requestWorkbench("github.pr.heads.list", {
    projectId,
    repo,
  });
}

export async function listGithubPrs(
  projectId: string,
  repo: string,
  filters: GithubPrListFilters,
): Promise<GithubPrListResponse> {
  return await requestWorkbench("github.pr.list", {
    projectId,
    repo,
    filters,
  });
}

async function getGithubPrSection<T>(
  operation:
    | "github.pr.core.get"
    | "github.pr.conversation.get"
    | "github.pr.overview.get"
    | "github.pr.commits.get"
    | "github.pr.checks.get",
  projectId: string,
  repo: string,
  number: number,
): Promise<T> {
  return (await requestWorkbench(operation, { projectId, repo, number })) as T;
}

export async function getGithubPrInitial(
  projectId: string,
  repo: string,
  number: number,
): Promise<GithubPrInitial> {
  return await requestWorkbench("github.pr.initial.get", {
    projectId,
    repo,
    number,
  });
}

export const getGithubPrCore = (
  projectId: string,
  repo: string,
  number: number,
): Promise<GithubPrCore> =>
  getGithubPrSection("github.pr.core.get", projectId, repo, number);

export const getGithubPrConversation = (
  projectId: string,
  repo: string,
  number: number,
): Promise<GithubPrConversation> =>
  getGithubPrSection("github.pr.conversation.get", projectId, repo, number);

export const getGithubPrOverview = (
  projectId: string,
  repo: string,
  number: number,
): Promise<GithubPrOverview> =>
  getGithubPrSection("github.pr.overview.get", projectId, repo, number);

export const getGithubPrCommits = (
  projectId: string,
  repo: string,
  number: number,
): Promise<GithubPrCommitsResponse> =>
  getGithubPrSection("github.pr.commits.get", projectId, repo, number);

export const getGithubPrChecks = (
  projectId: string,
  repo: string,
  number: number,
): Promise<GithubPrChecksResponse> =>
  getGithubPrSection("github.pr.checks.get", projectId, repo, number);

export async function getGithubPrFileDiff(input: {
  projectId: string;
  repo: string;
  number: number;
  path: string;
  previousPath?: string;
  status: GithubPrFileStatus;
  expectedBaseRefOid: string;
  expectedHeadRefOid: string;
  expectedHeadRepository?: string;
}): Promise<GithubPrFileDiffResponse> {
  return await requestWorkbench("github.pr.file.diff.get", {
    projectId: input.projectId,
    repo: input.repo,
    number: input.number,
    path: input.path,
    ...(input.previousPath ? { previousPath: input.previousPath } : {}),
    status: input.status,
    expectedBaseRefOid: input.expectedBaseRefOid,
    expectedHeadRefOid: input.expectedHeadRefOid,
    ...(input.expectedHeadRepository
      ? { expectedHeadRepository: input.expectedHeadRepository }
      : {}),
  });
}

export async function getGithubPrFiles(
  projectId: string,
  repo: string,
  number: number,
): Promise<GithubPrFilesResponse> {
  return await requestWorkbench("github.pr.files.get", {
    projectId,
    repo,
    number,
  });
}

export async function mergeGithubPr(
  projectId: string,
  repo: string,
  number: number,
  method: GithubPrMergeMethod,
  expectedHeadOid: string,
): Promise<GithubPrMergeResponse> {
  return await requestWorkbench("github.pr.merge", {
    projectId,
    repo,
    number,
    method,
    expectedHeadOid,
  });
}

export async function checkoutGithubPr(
  projectId: string,
  repo: string,
  number: number,
): Promise<GithubPrCheckoutResponse> {
  return await requestWorkbench("github.pr.checkout", {
    projectId,
    repo,
    number,
  });
}
