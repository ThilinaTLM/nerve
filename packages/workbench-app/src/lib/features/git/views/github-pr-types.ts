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
import type { ConversationSummary } from "@nervekit/contracts/core";
import type { ConversationActivity } from "$lib/presentation/conversations/conversation-activity";

/** A workspace conversation that created or mentioned the pull request. */
export type PrLinkedConversation = {
  conversation: ConversationSummary;
  activity: ConversationActivity;
};

export type GithubPrTab = "conversation" | "commits" | "checks" | "files";
/**
 * After a merge: nothing, switch the primary checkout to the base branch and
 * pull, or remove the linked worktree that held the merged branch.
 */
export type PrMergeFollowUp =
  | "stay"
  | "switch-base-and-pull"
  | "remove-worktree";

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
