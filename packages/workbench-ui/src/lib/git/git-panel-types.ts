import type {
  GitBranchSummary,
  GitFileChange,
  GithubPr,
  GithubStatusResponse,
  GitRepoSummary,
} from "@nervekit/contracts";

export type FeatureCapability =
  | { readonly enabled: true }
  | { readonly enabled: false; readonly reason: string };

export type FileMutation = {
  readonly path: string;
  readonly action: "stage" | "unstage" | "discard";
};

export type BulkFileMutation = "stage-all" | "unstage-all";
export type GitRemoteOperation =
  | "fetch"
  | "pull"
  | "push"
  | "sync"
  | "switch-base-and-pull";

export type GitPrFilterConfig = {
  readonly author: "any" | "me" | "username";
  readonly username: string;
  readonly drafts: "include" | "exclude" | "only";
  readonly title: string;
  readonly currentBranchOnly: boolean;
  readonly labels: readonly string[];
  readonly sort: "updated-desc" | "updated-asc";
};

export interface GitPanelCapabilities {
  readonly refresh: FeatureCapability;
  readonly selectRepository: FeatureCapability;
  readonly branches: FeatureCapability;
  readonly mutateFiles: FeatureCapability;
  readonly bulkMutateFiles: FeatureCapability;
  readonly remote: Readonly<Record<GitRemoteOperation, FeatureCapability>>;
  readonly openPullRequest: FeatureCapability;
}

export interface GitChangesModel {
  readonly files: readonly GitFileChange[];
  readonly stagedCount: number;
  readonly unstagedCount: number;
  readonly untrackedCount: number;
}

export interface GitPanelOperationState {
  readonly fetching: boolean;
  readonly pulling: boolean;
  readonly pushing: boolean;
  readonly syncing: boolean;
  readonly switchingBaseAndPulling: boolean;
  readonly switchingBranch?: string;
  readonly creatingBranch: boolean;
  readonly fileMutation?: FileMutation;
  readonly bulkMutation?: BulkFileMutation;
}

export type GitPanelSectionState = {
  readonly repository: boolean;
  readonly changes: boolean;
  readonly pullRequests: boolean;
};

export const defaultGitPanelSectionState: GitPanelSectionState = {
  repository: true,
  changes: true,
  pullRequests: true,
};

export interface GitPanelModel {
  readonly availability:
    | { readonly available: true }
    | { readonly available: false; readonly message: string };
  readonly emptyMessage?: string;
  readonly repositories: readonly GitRepoSummary[];
  readonly selectedRepository: string;
  readonly repositorySummary?: GitRepoSummary;
  readonly changes?: GitChangesModel;
  readonly branches: readonly GitBranchSummary[];
  readonly github?: GithubStatusResponse;
  readonly pullRequests: readonly GithubPr[];
  readonly pullRequestFilters: GitPrFilterConfig;
  readonly selectedPullRequestNumber?: number;
  readonly initialLoading: boolean;
  readonly cachedError?: string;
  readonly refreshing: boolean;
  readonly loadingOverview: boolean;
  readonly loadingBranches: boolean;
  readonly loadingPullRequests: boolean;
  readonly operations: GitPanelOperationState;
  readonly capabilities: GitPanelCapabilities;
}

export interface GitPanelActions {
  readonly refreshAll: () => void | Promise<void>;
  readonly refreshRepository: (repository: string) => void | Promise<void>;
  readonly refreshBranches: (repository: string) => void | Promise<void>;
  readonly refreshPullRequests: (repository: string) => void | Promise<void>;
  readonly configurePullRequests: (
    repository: string,
    filters: GitPrFilterConfig,
  ) => void | Promise<void>;
  readonly resetPullRequestConfig: (repository: string) => void | Promise<void>;
  readonly selectRepository: (repository: string) => void | Promise<void>;
  readonly createBranch: (
    repository: string,
    name: string,
  ) => boolean | void | Promise<boolean | void>;
  readonly switchBranch: (
    repository: string,
    branch: GitBranchSummary,
  ) => boolean | void | Promise<boolean | void>;
  readonly mutateFile: (
    repository: string,
    file: GitFileChange,
    action: FileMutation["action"],
  ) => void | Promise<void>;
  readonly bulkMutateFiles: (
    repository: string,
    action: BulkFileMutation,
  ) => void | Promise<void>;
  readonly runRemoteOperation: (
    repository: string,
    operation: GitRemoteOperation,
  ) => void | Promise<void>;
  readonly selectPullRequest: (
    number: number | undefined,
  ) => void | Promise<void>;
  readonly openPullRequest: (
    repository: string,
    number: number,
  ) => void | Promise<void>;
}

export const enabledCapability: FeatureCapability = { enabled: true };

export function disabledCapability(reason: string): FeatureCapability {
  return { enabled: false, reason };
}
