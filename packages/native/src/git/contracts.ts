import type { NativeErrorDetail } from "../core/error.js";

export interface NativeGitRepositoryInfo {
  gitDir: string;
  workDir?: string;
  bare: boolean;
}

export interface NativeGitRepositoryInfoResult {
  repository?: NativeGitRepositoryInfo;
  error?: NativeErrorDetail;
}

/**
 * Bounded, cancellable full snapshot. Limits fail explicitly rather than
 * truncate; results are also capped at 16 MiB (metadata) and 8 MiB (status),
 * and external clean/process filters are rejected as `isolation_required`.
 */
export interface NativeGitSnapshotOptions {
  includeIgnored?: boolean;
  /** Default 10. */
  recentCommitLimit?: number;
  /** Default 20,000 (the project status limit). */
  statusLimit?: number;
  /** Default 100,000. */
  refLimit?: number;
  /** Default 1,000. */
  stashLimit?: number;
  signal?: AbortSignal;
}

export interface NativeGitReference {
  name: string;
  target?: string;
  symbolicTarget?: string;
  upstream?: string;
  commitTimestampSeconds?: number;
}

export interface NativeGitRemote {
  name: string;
  fetchUrl?: string;
  pushUrl?: string;
}

export interface NativeGitFileStatus {
  path: string;
  renamedFrom?: string;
  index: string;
  worktree: string;
  untracked: boolean;
  ignored: boolean;
}

export interface NativeGitRecentCommit {
  oid: string;
  subject: string;
  timestampSeconds: number;
}

export interface NativeGitStash {
  index: number;
  oid: string;
  message: string;
  timestampSeconds: number;
}

export interface NativeGitSnapshot {
  gitDir: string;
  workDir?: string;
  headOid?: string;
  headBranch?: string;
  detached: boolean;
  upstream?: string;
  ahead?: number;
  behind?: number;
  inProgress: string[];
  refs: NativeGitReference[];
  remotes: NativeGitRemote[];
  files: NativeGitFileStatus[];
  recentCommits: NativeGitRecentCommit[];
  stashes: NativeGitStash[];
}

export interface NativeGitSnapshotResult {
  snapshot?: NativeGitSnapshot;
  error?: NativeErrorDetail;
}

export interface NativeGitAncestry {
  ancestorOid: string;
  descendantOid: string;
  isAncestor: boolean;
}

export interface NativeGitAncestryResult {
  ancestry?: NativeGitAncestry;
  error?: NativeErrorDetail;
}

export type NativeGitDocumentSource = {
  kind: "revision" | "index" | "worktree" | "empty";
  path: string;
  revision?: string;
};

export type NativeGitFileDocument = {
  content?: string;
  binary: boolean;
  size: number;
};

export type NativeGitFileDiff = {
  original: NativeGitFileDocument;
  modified: NativeGitFileDocument;
};

export interface NativeGitFileDiffResult {
  diff?: NativeGitFileDiff;
  error?: NativeErrorDetail;
}

export interface NativeGitRevisionResult {
  oid?: string;
  error?: NativeErrorDetail;
}

export interface NativeGitCountResult {
  count?: number;
  error?: NativeErrorDetail;
}

/** Full metadata without status, index traversal, filters or worktree scanning. */
export type NativeGitMetadataSnapshot = Omit<NativeGitSnapshot, "files">;
export interface NativeGitMetadataSnapshotOptions {
  /** Default 100,000. Overflow fails; zero does not mean omit refs. */
  refLimit?: number;
  /** Default 0: skip history traversal entirely. */
  recentCommitLimit?: number;
  /** Default 0: skip stash reflog traversal entirely. */
  stashLimit?: number;
  signal?: AbortSignal;
}
