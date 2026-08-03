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
} from "@nervekit/contracts";

export type GithubPrTab = "conversation" | "commits" | "checks" | "files";

export type PrSectionState<T> = {
  data?: T;
  loading: boolean;
  refreshing: boolean;
  error?: string;
};

export type GithubPrViewState = {
  id: string;
  repo: string;
  number: number;
  summary?: GithubPr;
  core: PrSectionState<GithubPrCore>;
  conversation: PrSectionState<GithubPrConversation>;
  overview: PrSectionState<GithubPrOverview>;
  commits: PrSectionState<GithubPrCommitsResponse>;
  checks: PrSectionState<GithubPrChecksResponse>;
  files: PrSectionState<GithubPrFilesResponse>;
  fileDiffs: Record<string, PrSectionState<GithubPrFileDiffResponse>>;
  activeTab: GithubPrTab;
  selectedFilePath?: string;
  selectedMergeMethod?: GithubPrMergeMethod;
  refreshing: boolean;
  refreshError?: string;
  merging: boolean;
  mergeError?: string;
};

export type PrViewState = GithubPrViewState;
