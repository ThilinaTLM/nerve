import type { GitDiffArea, GitFileDiffResponse } from "@nervekit/contracts";

export type GitDiffPaneModel = {
  path: string;
  renamedFrom?: string;
  repo: string;
  area: GitDiffArea;
  data?: GitFileDiffResponse;
  loading: boolean;
  refreshing: boolean;
  error?: string;
};
