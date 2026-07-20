import type {
  CreateBranchRequest,
  GitBranchListResponse,
  GitDiscoveryResponse,
  GitFileActionRequest,
  GithubPrCheckoutResponse,
  GithubPrDetail,
  GithubPrListFilters,
  GithubPrListResponse,
  GithubStatusResponse,
  GitMutationResponse,
  GitOverviewResponse,
  GitRemoteOpRequest,
  SwitchBranchRequest,
} from "@nervekit/contracts";
import { sandboxProtocolRequest } from "./manager-protocol-client";

// Wire-level project id for git operations. The sandbox agent ignores it and
// always operates on its own workspace, but the shared git operation schemas
// require the workbench "proj_" prefix.
const SANDBOX_PROJECT_ID = "proj_sandbox_workspace";

export async function discoverSandboxGitRepos(
  sandboxId: string,
): Promise<GitDiscoveryResponse> {
  return (
    await sandboxProtocolRequest(sandboxId, "git.repos.discover", {
      projectId: SANDBOX_PROJECT_ID,
    })
  ).result;
}

export async function getSandboxGitOverview(
  sandboxId: string,
  repo = ".",
): Promise<GitOverviewResponse> {
  return (
    await sandboxProtocolRequest(sandboxId, "git.overview.get", {
      projectId: SANDBOX_PROJECT_ID,
      repo,
    })
  ).result;
}

export async function listSandboxGitBranches(
  sandboxId: string,
  repo = ".",
): Promise<GitBranchListResponse> {
  return (
    await sandboxProtocolRequest(sandboxId, "git.branches.list", {
      projectId: SANDBOX_PROJECT_ID,
      repo,
    })
  ).result;
}

export async function createSandboxGitBranch(
  sandboxId: string,
  request: CreateBranchRequest,
): Promise<GitMutationResponse> {
  return (
    await sandboxProtocolRequest(
      sandboxId,
      "git.branch.create",
      { projectId: SANDBOX_PROJECT_ID, ...request },
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
    await sandboxProtocolRequest(
      sandboxId,
      "git.branch.switch",
      { projectId: SANDBOX_PROJECT_ID, ...request },
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
    await sandboxProtocolRequest(
      sandboxId,
      method,
      { projectId: SANDBOX_PROJECT_ID, ...request },
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
    await sandboxProtocolRequest(
      sandboxId,
      method,
      { projectId: SANDBOX_PROJECT_ID, ...request },
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
    await sandboxProtocolRequest(sandboxId, "github.status.get", {
      projectId: SANDBOX_PROJECT_ID,
      repo,
    })
  ).result;
}

export async function listSandboxGithubPrs(
  sandboxId: string,
  repo: string,
  filters: GithubPrListFilters,
): Promise<GithubPrListResponse> {
  return (
    await sandboxProtocolRequest(sandboxId, "github.pr.list", {
      projectId: SANDBOX_PROJECT_ID,
      repo,
      filters,
    })
  ).result;
}

export async function getSandboxGithubPr(
  sandboxId: string,
  repo: string,
  number: number,
): Promise<GithubPrDetail> {
  return (
    await sandboxProtocolRequest(sandboxId, "github.pr.get", {
      projectId: SANDBOX_PROJECT_ID,
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
    await sandboxProtocolRequest(
      sandboxId,
      "github.pr.checkout",
      { projectId: SANDBOX_PROJECT_ID, repo, number },
      {
        idempotencyKey: `sandbox-pr-checkout-${sandboxId}-${repo}-${number}-${Date.now()}`,
      },
    )
  ).result;
}
