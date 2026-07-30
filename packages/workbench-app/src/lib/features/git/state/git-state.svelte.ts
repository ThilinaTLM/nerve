import type {
  GithubPrChecksResponse,
  GithubPrCommitsResponse,
  GithubPrConversation,
  GithubPrCore,
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
  core: PrResourceState<GithubPrCore>;
  conversation: PrResourceState<GithubPrConversation>;
  overview: PrResourceState<GithubPrOverview>;
  commits: PrResourceState<GithubPrCommitsResponse>;
  checks: PrResourceState<GithubPrChecksResponse>;
  files: PrResourceState<GithubPrFilesResponse>;
  activeTab: GithubPrTab;
  selectedFilePath?: string;
  selectedMergeMethod?: GithubPrMergeMethod;
  merging: boolean;
  mergeError?: string;
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
});
