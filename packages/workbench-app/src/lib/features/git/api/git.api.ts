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
} from "@nervekit/contracts";
import { protocolRequest } from "@nervekit/protocol";

export async function discoverGitRepos(
  projectId: string,
): Promise<GitDiscoveryResponse> {
  return (
    await protocolRequest("git.repos.discover", {
      projectId,
    })
  ).result;
}

export async function getGitOverview(
  projectId: string,
  repo: string,
): Promise<GitOverviewResponse> {
  return (
    await protocolRequest("git.overview.get", {
      projectId,
      repo,
    })
  ).result;
}

export async function getProjectGitFileStatus(
  projectId: string,
): Promise<GitProjectFileStatusResponse> {
  return (await protocolRequest("git.project.files.status.get", { projectId }))
    .result;
}

export async function listGitBranches(
  projectId: string,
  repo: string,
): Promise<GitBranchListResponse> {
  return (
    await protocolRequest("git.branches.list", {
      projectId,
      repo,
    })
  ).result;
}

export async function createGitBranch(
  projectId: string,
  repo: string,
  name: string,
): Promise<GitMutationResponse> {
  return (
    await protocolRequest("git.branch.create", {
      projectId,
      repo,
      name,
    })
  ).result;
}

export async function switchGitBranch(
  projectId: string,
  repo: string,
  name: string,
): Promise<GitMutationResponse> {
  return (
    await protocolRequest("git.branch.switch", {
      projectId,
      repo,
      name,
    })
  ).result;
}

export async function syncGitBranch(
  projectId: string,
  repo: string,
): Promise<GitMutationResponse> {
  return (await protocolRequest("git.sync", { projectId, repo })).result;
}

export async function pushGit(
  projectId: string,
  repo: string,
): Promise<GitMutationResponse> {
  return (await protocolRequest("git.push", { projectId, repo })).result;
}

export async function pullGit(
  projectId: string,
  repo: string,
): Promise<GitMutationResponse> {
  return (await protocolRequest("git.pull", { projectId, repo })).result;
}

export async function fetchGit(
  projectId: string,
  repo: string,
): Promise<GitMutationResponse> {
  return (await protocolRequest("git.fetch", { projectId, repo })).result;
}

export async function switchBaseAndPullGit(
  projectId: string,
  repo: string,
): Promise<GitMutationResponse> {
  return (
    await protocolRequest("git.switchBaseAndPull", {
      projectId,
      repo,
    })
  ).result;
}

export async function getGitFileDiff(
  projectId: string,
  repo: string,
  path: string,
  area: GitDiffArea,
): Promise<GitFileDiffResponse> {
  return (
    await protocolRequest("git.file.diff.get", {
      projectId,
      repo,
      path,
      area,
    })
  ).result;
}

export async function stageGitFile(
  projectId: string,
  repo: string,
  path: string,
): Promise<GitMutationResponse> {
  return (
    await protocolRequest("git.file.stage", {
      projectId,
      repo,
      path,
    })
  ).result;
}

export async function unstageGitFile(
  projectId: string,
  repo: string,
  path: string,
): Promise<GitMutationResponse> {
  return (
    await protocolRequest("git.file.unstage", {
      projectId,
      repo,
      path,
    })
  ).result;
}

export async function discardGitFile(
  projectId: string,
  repo: string,
  path: string,
): Promise<GitMutationResponse> {
  return (
    await protocolRequest("git.file.discard", {
      projectId,
      repo,
      path,
    })
  ).result;
}

export async function getGithubStatus(
  projectId: string,
  repo: string,
): Promise<GithubStatusResponse> {
  return (
    await protocolRequest("github.status.get", {
      projectId,
      repo,
    })
  ).result;
}

export async function listGithubPrs(
  projectId: string,
  repo: string,
  filters: GithubPrListFilters,
): Promise<GithubPrListResponse> {
  return (
    await protocolRequest("github.pr.list", {
      projectId,
      repo,
      filters,
    })
  ).result;
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
  return (await protocolRequest(operation, { projectId, repo, number }))
    .result as T;
}

export async function getGithubPrInitial(
  projectId: string,
  repo: string,
  number: number,
): Promise<GithubPrInitial> {
  return (
    await protocolRequest("github.pr.initial.get", {
      projectId,
      repo,
      number,
    })
  ).result;
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
  return (
    await protocolRequest("github.pr.file.diff.get", {
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
    })
  ).result;
}

export async function getGithubPrFiles(
  projectId: string,
  repo: string,
  number: number,
): Promise<GithubPrFilesResponse> {
  return (
    await protocolRequest("github.pr.files.get", {
      projectId,
      repo,
      number,
    })
  ).result;
}

export async function mergeGithubPr(
  projectId: string,
  repo: string,
  number: number,
  method: GithubPrMergeMethod,
  expectedHeadOid: string,
): Promise<GithubPrMergeResponse> {
  return (
    await protocolRequest("github.pr.merge", {
      projectId,
      repo,
      number,
      method,
      expectedHeadOid,
    })
  ).result;
}

export async function checkoutGithubPr(
  projectId: string,
  repo: string,
  number: number,
): Promise<GithubPrCheckoutResponse> {
  return (
    await protocolRequest("github.pr.checkout", {
      projectId,
      repo,
      number,
    })
  ).result;
}
