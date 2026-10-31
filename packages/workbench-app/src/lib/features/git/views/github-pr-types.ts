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
} from "@nervekit/contracts/git";
import type { ConversationActivity } from "$lib/presentation/conversations/conversation-activity";

/** A workspace conversation that created or mentioned the pull request. */
export type PrLinkedConversation = {
  id: string;
  title: string;
  activity: ConversationActivity;
  relationship: "created" | "referenced";
  /** Last user prompt, falling back to creation time. */
  at: string;
};

export type GithubPrTab = "conversation" | "commits" | "checks" | "files";
export type PrMergeFollowUp = "stay" | "switch-base-and-pull";

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
  merging: boolean;
};

export type PrViewState = GithubPrViewState;
