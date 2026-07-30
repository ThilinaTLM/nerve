import type {
  GithubPrChecksResponse,
  GithubPrCommitsResponse,
  GithubPrConversation,
  GithubPrCore,
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
  core: PrSectionState<GithubPrCore>;
  conversation: PrSectionState<GithubPrConversation>;
  overview: PrSectionState<GithubPrOverview>;
  commits: PrSectionState<GithubPrCommitsResponse>;
  checks: PrSectionState<GithubPrChecksResponse>;
  files: PrSectionState<GithubPrFilesResponse>;
  activeTab: GithubPrTab;
  selectedFilePath?: string;
  selectedMergeMethod?: GithubPrMergeMethod;
  merging: boolean;
  mergeError?: string;
};

export type PrViewState = GithubPrViewState;
