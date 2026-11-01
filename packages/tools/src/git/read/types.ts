import type {
  GitFileChange,
  GitRecentCommit,
  GitStashEntry,
} from "@nervekit/contracts/git";
import type {
  NativeGitDocumentSource,
  NativeGitFileDiff,
  NativeGitDiscovery,
  NativeGitProjectRepository,
  NativeGitProjectRepositoryResult,
  NativeGitStatusCounts,
  NativeGitMetadataSnapshotOptions,
} from "@nervekit/native";

export interface GitReadRef {
  name: string;
  target?: string;
  symbolicTarget?: string;
  upstream?: string;
  commitTimestampSeconds?: number;
}

export interface GitReadRemote {
  name: string;
  fetchUrl?: string;
  pushUrl?: string;
}

export interface GitReadSnapshot {
  headOid: string | null;
  branch: {
    head: string | null;
    detached: boolean;
    upstream: string | null;
    ahead: number | null;
    behind: number | null;
  };
  refs: GitReadRef[];
  remotes: GitReadRemote[];
  files: GitFileChange[];
  recentCommits: GitRecentCommit[];
  stashes: GitStashEntry[];
}

export type GitReadMetadataSnapshot = Omit<GitReadSnapshot, "files">;
export type GitReadMetadataOptions = NativeGitMetadataSnapshotOptions;

export type GitReadProjectRepository = NativeGitProjectRepository;
export type GitReadDiscovery = NativeGitDiscovery;
export type GitReadProjectSnapshot = Pick<
  GitReadSnapshot,
  "headOid" | "branch" | "files"
> & { counts: NativeGitStatusCounts; inProgress: string[] };
export type GitReadProjectResult = Omit<
  NativeGitProjectRepositoryResult,
  "snapshot"
> & { snapshot?: GitReadProjectSnapshot };

export interface GitReadBackend {
  close(): Promise<void>;
  discoverProject(
    root: string,
    signal?: AbortSignal,
  ): Promise<GitReadDiscovery>;
  projectSnapshots(
    repositories: GitReadProjectRepository[],
    includeIgnored?: boolean,
    signal?: AbortSignal,
  ): Promise<GitReadProjectResult[]>;
  isRepository(repoDir: string): Promise<boolean>;
  metadata(
    repoDir: string,
    options?: GitReadMetadataOptions,
  ): Promise<GitReadMetadataSnapshot>;
  snapshot(repoDir: string, includeIgnored?: boolean): Promise<GitReadSnapshot>;
  isAncestor(
    repoDir: string,
    ancestor: string,
    descendant: string,
  ): Promise<boolean>;
  resolveRevision(repoDir: string, revision: string): Promise<string>;
  /** Commits on HEAD that no `refs/remotes/<remote>/*` ref contains. */
  countUnpublishedCommits(repoDir: string, remote: string): Promise<number>;
  validateBranchName(name: string): Promise<boolean>;
  fileDiff(
    repoDir: string,
    original: NativeGitDocumentSource,
    modified: NativeGitDocumentSource,
  ): Promise<NativeGitFileDiff>;
}
