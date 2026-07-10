import type {
  GitBranchListResponse,
  GitDiscoveryResponse,
  GithubPrDetail,
  GithubPrListResponse,
  GithubStatusResponse,
  GitOverviewResponse,
} from "@nervekit/contracts";

export type FileMutation = {
  path: string;
  action: "stage" | "unstage" | "discard";
};

export interface GitPanelModel {
  readonly loading: boolean;
  readonly error?: string;
  readonly discovery?: GitDiscoveryResponse;
  readonly overview?: GitOverviewResponse;
  readonly branches?: GitBranchListResponse;
  readonly github?: GithubStatusResponse;
  readonly pullRequests?: GithubPrListResponse;
  readonly selectedPullRequest?: GithubPrDetail;
}

export interface GitPanelActions {
  readonly refresh: () => void | Promise<void>;
  readonly createBranch: (
    name: string,
    startPoint?: string,
  ) => void | Promise<void>;
  readonly switchBranch: (name: string) => void | Promise<void>;
  readonly mutateFile: (mutation: FileMutation) => void | Promise<void>;
  readonly sync: (
    action: "sync" | "push" | "pull" | "fetch",
  ) => void | Promise<void>;
  readonly checkoutPullRequest: (number: number) => void | Promise<void>;
  readonly selectPullRequest: (number: number) => void | Promise<void>;
}
