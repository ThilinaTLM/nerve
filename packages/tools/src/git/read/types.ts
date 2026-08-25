import type {
  GitFileChange,
  GitRecentCommit,
  GitStashEntry,
} from "@nervekit/contracts";
import type {
  NativeGitDocumentSource,
  NativeGitFileDiff,
} from "@nervekit/native";

export interface GitReadRef {
  name: string;
  target?: string;
  symbolicTarget?: string;
  upstream?: string;
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

export interface GitReadBackend {
  isRepository(repoDir: string): Promise<boolean>;
  snapshot(repoDir: string, includeIgnored?: boolean): Promise<GitReadSnapshot>;
  isAncestor(
    repoDir: string,
    ancestor: string,
    descendant: string,
  ): Promise<boolean>;
  resolveRevision(repoDir: string, revision: string): Promise<string>;
  validateBranchName(name: string): Promise<boolean>;
  fileDiff(
    repoDir: string,
    original: NativeGitDocumentSource,
    modified: NativeGitDocumentSource,
  ): Promise<NativeGitFileDiff>;
}
