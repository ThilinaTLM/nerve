import type { NativeErrorDetail } from "../core/error.js";
import type { NativeGitFileStatus } from "./contracts.js";

export interface NativeGitProjectRepository {
  relativePath: string;
  workDir: string;
  gitDir: string;
  commonDir: string;
}
export interface NativeGitDiscovery {
  root: string;
  projectIsRepo: boolean;
  repositories: NativeGitProjectRepository[];
}
export interface NativeGitStatusCounts {
  staged: number;
  unstaged: number;
  untracked: number;
  ignored: number;
  conflicted: number;
}
export interface NativeGitProjectSnapshot {
  headOid?: string;
  branch?: string;
  detached: boolean;
  upstream?: string;
  ahead?: number;
  behind?: number;
  inProgress: string[];
  counts: NativeGitStatusCounts;
  files: NativeGitFileStatus[];
}
export interface NativeGitProjectRepositoryResult {
  repository: NativeGitProjectRepository;
  snapshot?: NativeGitProjectSnapshot;
  error?: NativeErrorDetail;
}
export interface NativeGitProjectReadOptions {
  signal?: AbortSignal;
}
export interface NativeGitProjectSnapshotOptions extends NativeGitProjectReadOptions {
  includeIgnored?: boolean;
}

export interface NativeGitProjectBinding {
  createGitReadOperation(): { handle?: number; error?: NativeErrorDetail };
  cancelGitReadOperation(handle: number): void;
  closeGitReadOperation(handle: number): void;
  discoverGitRepositories(
    root: string,
    handle: number,
  ): Promise<{ discovery?: NativeGitDiscovery; error?: NativeErrorDetail }>;
  readGitProjectSnapshots(
    repositories: NativeGitProjectRepository[],
    ignored: boolean,
    handle: number,
  ): Promise<{
    repositories?: NativeGitProjectRepositoryResult[];
    error?: NativeErrorDetail;
  }>;
}
