import type {
  NativeGitAncestryResult,
  NativeGitDocumentSource,
  NativeGitFileDiffResult,
  NativeGitRepositoryInfoResult,
  NativeGitRevisionResult,
  NativeGitSnapshotOptions,
  NativeGitSnapshotResult,
} from "./contracts.js";

export interface GitNativeBinding {
  readGitRepositoryInfo(path: string): Promise<NativeGitRepositoryInfoResult>;
  readGitSnapshot(
    path: string,
    options?: NativeGitSnapshotOptions,
  ): Promise<NativeGitSnapshotResult>;
  checkGitAncestry(
    path: string,
    ancestor: string,
    descendant: string,
  ): Promise<NativeGitAncestryResult>;
  resolveGitRevision(
    path: string,
    revision: string,
  ): Promise<NativeGitRevisionResult>;
  readGitFileDiff(
    path: string,
    original: NativeGitDocumentSource,
    modified: NativeGitDocumentSource,
  ): Promise<NativeGitFileDiffResult>;
  validateGitBranchName(name: string): boolean;
}
