export type GitWorkspaceRef = {
  dir: string;
  name: string;
};

export interface GitCommandObservation {
  readonly bin: "git" | "gh";
  readonly command: string;
  readonly durationMs: number;
  readonly succeeded: boolean;
}

export interface GitOverviewObservation {
  readonly durationMs: number;
  readonly succeeded: boolean;
}

export interface GitServiceOptions {
  readonly stableMetadataTtlMs?: number;
  readonly now?: () => number;
  readonly onCommandCompleted?: (observation: GitCommandObservation) => void;
  readonly onOverviewCompleted?: (observation: GitOverviewObservation) => void;
}
