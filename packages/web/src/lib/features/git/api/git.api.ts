import type {
  GitBranchListResponse,
  GitDiscoveryResponse,
  GithubPrCheckoutResponse,
  GithubPrDetail,
  GithubPrListResponse,
  GithubStatusResponse,
  GitMutationResponse,
  GitOverviewResponse,
} from "@nervekit/shared";
import { protocolRequest } from "../../../core/protocol/http-client";

export async function discoverGitRepos(
  projectId: string,
): Promise<GitDiscoveryResponse> {
  return (
    await protocolRequest<GitDiscoveryResponse>("git.repos.discover", {
      projectId,
    })
  ).result;
}

export async function getGitOverview(
  projectId: string,
  repo: string,
): Promise<GitOverviewResponse> {
  return (
    await protocolRequest<GitOverviewResponse>("git.overview.get", {
      projectId,
      repo,
    })
  ).result;
}

export async function listGitBranches(
  projectId: string,
  repo: string,
): Promise<GitBranchListResponse> {
  return (
    await protocolRequest<GitBranchListResponse>("git.branches.list", {
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
    await protocolRequest<GitMutationResponse>("git.branch.create", {
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
    await protocolRequest<GitMutationResponse>("git.branch.switch", {
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
  return (
    await protocolRequest<GitMutationResponse>("git.sync", { projectId, repo })
  ).result;
}

export async function pushGit(
  projectId: string,
  repo: string,
): Promise<GitMutationResponse> {
  return (
    await protocolRequest<GitMutationResponse>("git.push", { projectId, repo })
  ).result;
}

export async function pullGit(
  projectId: string,
  repo: string,
): Promise<GitMutationResponse> {
  return (
    await protocolRequest<GitMutationResponse>("git.pull", { projectId, repo })
  ).result;
}

export async function fetchGit(
  projectId: string,
  repo: string,
): Promise<GitMutationResponse> {
  return (
    await protocolRequest<GitMutationResponse>("git.fetch", { projectId, repo })
  ).result;
}

export async function switchBaseAndPullGit(
  projectId: string,
  repo: string,
): Promise<GitMutationResponse> {
  return (
    await protocolRequest<GitMutationResponse>("git.switchBaseAndPull", {
      projectId,
      repo,
    })
  ).result;
}

export async function stageGitFile(
  projectId: string,
  repo: string,
  path: string,
): Promise<GitMutationResponse> {
  return (
    await protocolRequest<GitMutationResponse>("git.file.stage", {
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
    await protocolRequest<GitMutationResponse>("git.file.unstage", {
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
    await protocolRequest<GitMutationResponse>("git.file.discard", {
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
    await protocolRequest<GithubStatusResponse>("github.status.get", {
      projectId,
      repo,
    })
  ).result;
}

export async function listGithubPrs(
  projectId: string,
  repo: string,
): Promise<GithubPrListResponse> {
  return (
    await protocolRequest<GithubPrListResponse>("github.pr.list", {
      projectId,
      repo,
    })
  ).result;
}

export async function getGithubPr(
  projectId: string,
  repo: string,
  number: number,
): Promise<GithubPrDetail> {
  return (
    await protocolRequest<GithubPrDetail>("github.pr.get", {
      projectId,
      repo,
      number,
    })
  ).result;
}

export async function checkoutGithubPr(
  projectId: string,
  repo: string,
  number: number,
): Promise<GithubPrCheckoutResponse> {
  return (
    await protocolRequest<GithubPrCheckoutResponse>("github.pr.checkout", {
      projectId,
      repo,
      number,
    })
  ).result;
}
