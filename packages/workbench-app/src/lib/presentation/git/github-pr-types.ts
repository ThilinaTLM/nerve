import type {
  GithubPrDetail,
  GithubPrFilesResponse,
  GithubPrMergeMethod,
} from "@nervekit/contracts";

export type GithubPrTab = "conversation" | "commits" | "checks" | "files";

export type GithubPrViewState = {
  id: string;
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

export type PrViewState = GithubPrViewState;
