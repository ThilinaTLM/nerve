import type {
  NativeGitAncestryResult,
  NativeGitCountResult,
  NativeGitDocumentSource,
  NativeGitFileDiffResult,
  NativeGitRepositoryInfoResult,
  NativeGitRevisionResult,
  NativeGitSnapshotOptions,
  NativeGitSnapshotResult,
} from "./contracts.js";

import type { NativeGitProjectBinding } from "./project-contracts.js";

import type {
  NativeGitMetadataSnapshot,
  NativeGitMetadataSnapshotOptions,
} from "./contracts.js";
import type { NativeErrorDetail } from "../core/error.js";
export interface NativeGitMetadataBinding extends Pick<
  NativeGitProjectBinding,
  "createGitReadOperation" | "cancelGitReadOperation" | "closeGitReadOperation"
> {
  readGitMetadataSnapshot(
    path: string,
    options: Omit<NativeGitMetadataSnapshotOptions, "signal">,
    handle: number,
  ): Promise<{
    snapshot?: NativeGitMetadataSnapshot;
    error?: NativeErrorDetail;
  }>;
}

export interface NativeGitBinding
  extends NativeGitProjectBinding, NativeGitMetadataBinding {
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
  countUnpublishedGitCommits(
    path: string,
    remote: string,
  ): Promise<NativeGitCountResult>;
  readGitFileDiff(
    path: string,
    original: NativeGitDocumentSource,
    modified: NativeGitDocumentSource,
  ): Promise<NativeGitFileDiffResult>;
  validateGitBranchName(name: string): boolean;
}
