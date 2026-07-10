import type {
  CreateBranchRequest,
  GitBranchListResponse,
  GitDiscoveryResponse,
  GitFileActionRequest,
  GithubPrCheckoutResponse,
  GithubPrDetail,
  GithubPrListResponse,
  GithubStatusResponse,
  GitMutationResponse,
  GitOverviewResponse,
  GitRemoteOpRequest,
  SwitchBranchRequest,
} from "@nervekit/contracts";
import { protocolRequest } from "./manager-protocol-client";

export async function discoverSandboxGitRepos(
  sandboxId: string,
): Promise<GitDiscoveryResponse> {
  return (
    await protocolRequest<GitDiscoveryResponse>("git.repos.discover", {
      sandboxId,
    })
  ).result;
}

export async function getSandboxGitOverview(
  sandboxId: string,
  repo = ".",
): Promise<GitOverviewResponse> {
  return (
    await protocolRequest<GitOverviewResponse>("git.overview.get", {
      sandboxId,
      repo,
    })
  ).result;
}

export async function listSandboxGitBranches(
  sandboxId: string,
  repo = ".",
): Promise<GitBranchListResponse> {
  return (
    await protocolRequest<GitBranchListResponse>("git.branches.list", {
      sandboxId,
      repo,
    })
  ).result;
}

export async function createSandboxGitBranch(
  sandboxId: string,
  request: CreateBranchRequest,
): Promise<GitMutationResponse> {
  return (
    await protocolRequest<GitMutationResponse>(
      "git.branch.create",
      { sandboxId, ...request },
      {
        idempotencyKey: `sandbox-git-create-${sandboxId}-${request.repo ?? "."}-${request.name}`,
      },
    )
  ).result;
}

export async function switchSandboxGitBranch(
  sandboxId: string,
  request: SwitchBranchRequest,
): Promise<GitMutationResponse> {
  return (
    await protocolRequest<GitMutationResponse>(
      "git.branch.switch",
      { sandboxId, ...request },
      {
        idempotencyKey: `sandbox-git-switch-${sandboxId}-${request.repo ?? "."}-${request.name}-${Date.now()}`,
      },
    )
  ).result;
}

export async function sandboxGitFileAction(
  sandboxId: string,
  action: "stage" | "unstage" | "discard",
  request: GitFileActionRequest,
): Promise<GitMutationResponse> {
  const method = `git.file.${action}` as const;
  return (
    await protocolRequest<GitMutationResponse>(
      method,
      { sandboxId, ...request },
      {
        idempotencyKey: `sandbox-git-file-${action}-${sandboxId}-${request.repo ?? "."}-${request.path}-${Date.now()}`,
      },
    )
  ).result;
}

export async function sandboxGitRemoteAction(
  sandboxId: string,
  action: "sync" | "push" | "pull" | "fetch" | "switchBaseAndPull",
  request: GitRemoteOpRequest,
): Promise<GitMutationResponse> {
  const method = `git.${action}` as const;
  return (
    await protocolRequest<GitMutationResponse>(
      method,
      { sandboxId, ...request },
      {
        idempotencyKey: `sandbox-git-${action}-${sandboxId}-${request.repo ?? "."}-${Date.now()}`,
      },
    )
  ).result;
}

export async function getSandboxGithubStatus(
  sandboxId: string,
  repo = ".",
): Promise<GithubStatusResponse> {
  return (
    await protocolRequest<GithubStatusResponse>("github.status.get", {
      sandboxId,
      repo,
    })
  ).result;
}

export async function listSandboxGithubPrs(
  sandboxId: string,
  repo = ".",
): Promise<GithubPrListResponse> {
  return (
    await protocolRequest<GithubPrListResponse>("github.pr.list", {
      sandboxId,
      repo,
    })
  ).result;
}

export async function getSandboxGithubPr(
  sandboxId: string,
  repo: string,
  number: number,
): Promise<GithubPrDetail> {
  return (
    await protocolRequest<GithubPrDetail>("github.pr.get", {
      sandboxId,
      repo,
      number,
    })
  ).result;
}

export async function checkoutSandboxGithubPr(
  sandboxId: string,
  repo: string,
  number: number,
): Promise<GithubPrCheckoutResponse> {
  return (
    await protocolRequest<GithubPrCheckoutResponse>(
      "github.pr.checkout",
      { sandboxId, repo, number },
      {
        idempotencyKey: `sandbox-pr-checkout-${sandboxId}-${repo}-${number}-${Date.now()}`,
      },
    )
  ).result;
}
