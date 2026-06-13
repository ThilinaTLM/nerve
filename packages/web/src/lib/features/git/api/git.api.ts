import type {
  GitBranchListResponse,
  GitDiscoveryResponse,
  GithubPrCheckoutResponse,
  GithubPrDetail,
  GithubPrListResponse,
  GithubStatusResponse,
  GitMutationResponse,
  GitOverviewResponse,
} from "@nerve/shared";
import { apiGet, apiPost } from "../../../shared/api/client";

export async function discoverGitRepos(
  projectId: string,
): Promise<GitDiscoveryResponse> {
  return apiGet<GitDiscoveryResponse>(`/api/projects/${projectId}/git/repos`);
}

export async function getGitOverview(
  projectId: string,
  repo: string,
): Promise<GitOverviewResponse> {
  const params = new URLSearchParams({ repo });
  return apiGet<GitOverviewResponse>(
    `/api/projects/${projectId}/git/overview?${params.toString()}`,
  );
}

export async function listGitBranches(
  projectId: string,
  repo: string,
): Promise<GitBranchListResponse> {
  const params = new URLSearchParams({ repo });
  return apiGet<GitBranchListResponse>(
    `/api/projects/${projectId}/git/branches?${params.toString()}`,
  );
}

export async function createGitBranch(
  projectId: string,
  repo: string,
  name: string,
): Promise<GitMutationResponse> {
  return apiPost<GitMutationResponse>(`/api/projects/${projectId}/git/branch`, {
    repo,
    name,
  });
}

export async function switchGitBranch(
  projectId: string,
  repo: string,
  name: string,
): Promise<GitMutationResponse> {
  return apiPost<GitMutationResponse>(
    `/api/projects/${projectId}/git/switch-branch`,
    { repo, name },
  );
}

export async function syncGitBranch(
  projectId: string,
  repo: string,
): Promise<GitMutationResponse> {
  return apiPost<GitMutationResponse>(`/api/projects/${projectId}/git/sync`, {
    repo,
  });
}

export async function pushGit(
  projectId: string,
  repo: string,
): Promise<GitMutationResponse> {
  return apiPost<GitMutationResponse>(`/api/projects/${projectId}/git/push`, {
    repo,
  });
}

export async function pullGit(
  projectId: string,
  repo: string,
): Promise<GitMutationResponse> {
  return apiPost<GitMutationResponse>(`/api/projects/${projectId}/git/pull`, {
    repo,
  });
}

export async function fetchGit(
  projectId: string,
  repo: string,
): Promise<GitMutationResponse> {
  return apiPost<GitMutationResponse>(`/api/projects/${projectId}/git/fetch`, {
    repo,
  });
}

export async function stageGitFile(
  projectId: string,
  repo: string,
  path: string,
): Promise<GitMutationResponse> {
  return apiPost<GitMutationResponse>(
    `/api/projects/${projectId}/git/stage-file`,
    { repo, path },
  );
}

export async function unstageGitFile(
  projectId: string,
  repo: string,
  path: string,
): Promise<GitMutationResponse> {
  return apiPost<GitMutationResponse>(
    `/api/projects/${projectId}/git/unstage-file`,
    { repo, path },
  );
}

export async function discardGitFile(
  projectId: string,
  repo: string,
  path: string,
): Promise<GitMutationResponse> {
  return apiPost<GitMutationResponse>(
    `/api/projects/${projectId}/git/discard-file`,
    { repo, path },
  );
}

export async function getGithubStatus(
  projectId: string,
  repo: string,
): Promise<GithubStatusResponse> {
  const params = new URLSearchParams({ repo });
  return apiGet<GithubStatusResponse>(
    `/api/projects/${projectId}/github/status?${params.toString()}`,
  );
}

export async function listGithubPrs(
  projectId: string,
  repo: string,
): Promise<GithubPrListResponse> {
  const params = new URLSearchParams({ repo });
  return apiGet<GithubPrListResponse>(
    `/api/projects/${projectId}/github/prs?${params.toString()}`,
  );
}

export async function getGithubPr(
  projectId: string,
  repo: string,
  number: number,
): Promise<GithubPrDetail> {
  const params = new URLSearchParams({ repo });
  return apiGet<GithubPrDetail>(
    `/api/projects/${projectId}/github/pr/${number}?${params.toString()}`,
  );
}

export async function checkoutGithubPr(
  projectId: string,
  repo: string,
  number: number,
): Promise<GithubPrCheckoutResponse> {
  return apiPost<GithubPrCheckoutResponse>(
    `/api/projects/${projectId}/github/pr/${number}/checkout`,
    { repo },
  );
}
