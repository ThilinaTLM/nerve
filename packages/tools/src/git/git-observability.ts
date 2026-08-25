import type { GitReadBackend } from "./read/types.js";

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

export interface GithubRequestObservation {
  readonly operation: string;
  readonly durationMs: number;
  readonly succeeded: boolean;
  readonly status?: number;
}

export interface GitOverviewObservation {
  readonly durationMs: number;
  readonly succeeded: boolean;
}

export interface GitReadObservation {
  readonly backend: "native";
  readonly operation: string;
  readonly durationMs: number;
  readonly succeeded: boolean;
}

export interface GitServiceOptions {
  readonly readBackend?: GitReadBackend;
  readonly stableMetadataTtlMs?: number;
  readonly now?: () => number;
  readonly onCommandCompleted?: (observation: GitCommandObservation) => void;
  readonly onReadCompleted?: (observation: GitReadObservation) => void;
  readonly onGithubRequestCompleted?: (
    observation: GithubRequestObservation,
  ) => void;
  readonly onOverviewCompleted?: (observation: GitOverviewObservation) => void;
}
