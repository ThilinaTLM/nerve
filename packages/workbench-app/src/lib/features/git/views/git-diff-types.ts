import type {
  GitChangeArea,
  GitFileDiffResponse,
} from "@nervekit/contracts/git";

export type GitDiffPaneModel = {
  path: string;
  renamedFrom?: string;
  repo: string;
  area: GitChangeArea;
  data?: GitFileDiffResponse;
  loading: boolean;
  refreshing: boolean;
  error?: string;
};
