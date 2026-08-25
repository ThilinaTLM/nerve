import type { GitFileChange } from "@nervekit/contracts";
import {
  checkGitAncestry,
  type NativeGitDocumentSource,
  type NativeGitFileDiff,
  readGitFileDiff,
  readGitRepositoryInfo,
  readGitSnapshot,
  resolveGitRevision,
  validateGitBranchName,
} from "@nervekit/native";
import type { GitReadBackend, GitReadSnapshot } from "./types.js";

export class NativeGitReadBackend implements GitReadBackend {
  constructor(private readonly now: () => number = Date.now) {}

  async isRepository(repoDir: string): Promise<boolean> {
    const info = await readGitRepositoryInfo(repoDir);
    return !info.bare && info.workDir !== undefined;
  }

  async snapshot(
    repoDir: string,
    includeIgnored = false,
  ): Promise<GitReadSnapshot> {
    const snapshot = await readGitSnapshot(repoDir, { includeIgnored });
    return {
      headOid: snapshot.headOid ?? null,
      branch: {
        head: snapshot.headBranch ?? null,
        detached: snapshot.detached,
        upstream: snapshot.upstream ?? null,
        ahead: snapshot.upstream ? (snapshot.ahead ?? 0) : null,
        behind: snapshot.upstream ? (snapshot.behind ?? 0) : null,
      },
      refs: snapshot.refs,
      remotes: snapshot.remotes,
      files: snapshot.files.map((file) => ({
        path: file.path.replace(/\/$/, ""),
        ...(file.renamedFrom ? { renamedFrom: file.renamedFrom } : {}),
        index: statusCode(file.index),
        worktree: statusCode(file.worktree),
        staged: file.index !== " " && file.index !== "?" && file.index !== "!",
        untracked: file.untracked,
      })),
      recentCommits: snapshot.recentCommits.map((commit) => ({
        hash: commit.oid.slice(0, 7),
        subject: commit.subject,
        relativeDate: relativeDate(commit.timestampSeconds, this.now()),
      })),
      stashes: snapshot.stashes.map((stash) => ({
        index: stash.index,
        ref: `stash@{${stash.index}}`,
        hash: stash.oid,
        message: stash.message,
        relativeDate: relativeDate(stash.timestampSeconds, this.now()),
      })),
    };
  }

  async isAncestor(
    repoDir: string,
    ancestor: string,
    descendant: string,
  ): Promise<boolean> {
    return (await checkGitAncestry(repoDir, ancestor, descendant)).isAncestor;
  }
  resolveRevision(repoDir: string, revision: string): Promise<string> {
    return resolveGitRevision(repoDir, revision);
  }
  async validateBranchName(name: string): Promise<boolean> {
    return validateGitBranchName(name);
  }
  fileDiff(
    repoDir: string,
    original: NativeGitDocumentSource,
    modified: NativeGitDocumentSource,
  ): Promise<NativeGitFileDiff> {
    return readGitFileDiff(repoDir, original, modified);
  }
}

function statusCode(value: string): GitFileChange["index"] {
  return value === "M" ||
    value === "A" ||
    value === "D" ||
    value === "R" ||
    value === "C" ||
    value === "U" ||
    value === "?" ||
    value === "!"
    ? value
    : " ";
}

function relativeDate(timestampSeconds: number, nowMs: number): string {
  const seconds = Math.max(0, Math.floor(nowMs / 1_000) - timestampSeconds);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}
