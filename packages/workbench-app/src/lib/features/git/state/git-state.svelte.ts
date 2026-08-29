import type { GitDiffArea, GitFileDiffResponse } from "@nervekit/contracts/git";
import type {
  GithubPr,
  GithubPrChecksResponse,
  GithubPrCommitsResponse,
  GithubPrConversation,
  GithubPrCore,
  GithubPrFileDiffResponse,
  GithubPrFilesResponse,
  GithubPrMergeMethod,
  GithubPrOverview,
  GitRepoSummary,
} from "$lib/api";

export type GithubPrTab = "conversation" | "commits" | "checks" | "files";

export type PrResourceState<T> = {
  data?: T;
  loading: boolean;
  refreshing: boolean;
  error?: string;
};

export type PrViewState = {
  /** `${projectId}:${encodeURIComponent(repo)}:${number}` */
  id: string;
  projectId: string;
  /** Relative repo path ("." for the project root). */
  repo: string;
  number: number;
  summary?: GithubPr;
  core: PrResourceState<GithubPrCore>;
  conversation: PrResourceState<GithubPrConversation>;
  overview: PrResourceState<GithubPrOverview>;
  commits: PrResourceState<GithubPrCommitsResponse>;
  checks: PrResourceState<GithubPrChecksResponse>;
  files: PrResourceState<GithubPrFilesResponse>;
  fileDiffs: Record<string, PrResourceState<GithubPrFileDiffResponse>>;
  activeTab: GithubPrTab;
  selectedFilePath?: string;
  selectedMergeMethod?: GithubPrMergeMethod;
  refreshing: boolean;
  refreshError?: string;
  merging: boolean;
  mergeError?: string;
};

export type DiffViewState = {
  id: string;
  projectId: string;
  repo: string;
  path: string;
  renamedFrom?: string;
  area: GitDiffArea;
  data?: GitFileDiffResponse;
  wrapLines: boolean;
  loading: boolean;
  refreshing: boolean;
  error?: string;
};

export type GitContext = {
  projectId: string;
  projectIsRepo: boolean;
  repos: GitRepoSummary[];
  github?: { available: boolean; authenticated: boolean };
  loadedAt: number;
};

export const gitState = $state({
  gitContext: undefined as GitContext | undefined,
  gitRefreshToken: 0,
  prViews: {} as Record<string, PrViewState>,
  openPrTabIds: [] as string[],
  diffViews: {} as Record<string, DiffViewState>,
  openDiffTabIds: [] as string[],
});
