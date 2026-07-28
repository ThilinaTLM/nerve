import type {
  GithubPrDetail,
  GithubPrFilesResponse,
  GithubPrMergeMethod,
  GitRepoSummary,
} from "$lib/api";

export type GithubPrTab = "conversation" | "commits" | "checks" | "files";

export type PrViewState = {
  /** `${projectId}:${encodeURIComponent(repo)}:${number}` */
  id: string;
  projectId: string;
  /** Relative repo path ("." for the project root). */
  repo: string;
  number: number;
  detail?: GithubPrDetail;
  loading: boolean;
  error?: string;
  activeTab: GithubPrTab;
  files?: GithubPrFilesResponse;
  filesLoading: boolean;
  filesError?: string;
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
