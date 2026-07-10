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
    await protocolRequest<GitDiscoveryResponse>("sandbox.git.repos.discover", {
      sandboxId,
    })
  ).result;
}

export async function getSandboxGitOverview(
  sandboxId: string,
  repo = ".",
): Promise<GitOverviewResponse> {
  return (
    await protocolRequest<GitOverviewResponse>("sandbox.git.overview.get", {
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
    await protocolRequest<GitBranchListResponse>("sandbox.git.branches.list", {
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
      "sandbox.git.branch.create",
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
      "sandbox.git.branch.switch",
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
  const method = `sandbox.git.file.${action}` as const;
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
  const method = `sandbox.git.${action}` as const;
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
    await protocolRequest<GithubStatusResponse>("sandbox.github.status.get", {
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
    await protocolRequest<GithubPrListResponse>("sandbox.github.pr.list", {
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
    await protocolRequest<GithubPrDetail>("sandbox.github.pr.get", {
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
      "sandbox.github.pr.checkout",
      { sandboxId, repo, number },
      {
        idempotencyKey: `sandbox-pr-checkout-${sandboxId}-${repo}-${number}-${Date.now()}`,
      },
    )
  ).result;
}
