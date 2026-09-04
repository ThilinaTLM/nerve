export type NativeGitErrorCategory =
  | "not_repository"
  | "not_found"
  | "unsupported"
  | "invalid_input"
  | "io"
  | "corrupt"
  | "limit_exceeded"
  | "cancelled"
  | "internal";

export interface NativeGitErrorDetail {
  category: NativeGitErrorCategory;
  message: string;
}

export interface NativeGitRepositoryInfo {
  gitDir: string;
  workDir?: string;
  bare: boolean;
}

export interface NativeGitRepositoryInfoResult {
  repository?: NativeGitRepositoryInfo;
  error?: NativeGitErrorDetail;
}

export interface NativeGitSnapshotOptions {
  includeIgnored?: boolean;
  recentCommitLimit?: number;
  statusLimit?: number;
  refLimit?: number;
  stashLimit?: number;
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
  refs: NativeGitReference[];
  remotes: NativeGitRemote[];
  files: NativeGitFileStatus[];
  recentCommits: NativeGitRecentCommit[];
  stashes: NativeGitStash[];
}

export interface NativeGitSnapshotResult {
  snapshot?: NativeGitSnapshot;
  error?: NativeGitErrorDetail;
}

export interface NativeGitAncestry {
  ancestorOid: string;
  descendantOid: string;
  isAncestor: boolean;
}

export interface NativeGitAncestryResult {
  ancestry?: NativeGitAncestry;
  error?: NativeGitErrorDetail;
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
  error?: NativeGitErrorDetail;
}

export interface NativeGitRevisionResult {
  oid?: string;
  error?: NativeGitErrorDetail;
}
