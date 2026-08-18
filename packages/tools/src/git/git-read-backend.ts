import { readFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import type {
  GitFileChange,
  GitRecentCommit,
  GitStashEntry,
} from "@nervekit/contracts";
import {
  checkGitAncestry,
  type NativeGitDocumentSource,
  type NativeGitFileDiff,
  NativeGitReadError,
  readGitFileDiff,
  readGitRepositoryInfo,
  readGitSnapshot,
  resolveGitRevision,
  validateGitBranchName,
} from "@nervekit/native";
import type { ExecResult } from "./git-command.js";
import { GitCommandError } from "./git-command.js";
import { parseStashList } from "./git-stash.js";
import { parsePorcelainV2 } from "./git-status.js";

export type GitReadRef = {
  name: string;
  target?: string;
  symbolicTarget?: string;
  upstream?: string;
};

export type GitReadRemote = {
  name: string;
  fetchUrl?: string;
  pushUrl?: string;
};

export type GitReadSnapshot = {
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
};

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

export class GitCliCompatibilityReadBackend implements GitReadBackend {
  constructor(
    private readonly runGit: (
      cwd: string,
      args: string[],
    ) => Promise<ExecResult>,
  ) {}

  async isRepository(repoDir: string): Promise<boolean> {
    try {
      return (
        (
          await this.runGit(repoDir, ["rev-parse", "--is-inside-work-tree"])
        ).stdout.trim() === "true"
      );
    } catch {
      return false;
    }
  }

  async snapshot(
    repoDir: string,
    includeIgnored = false,
  ): Promise<GitReadSnapshot> {
    const [status, refs, remotes, recent, stashes, head] = await Promise.all([
      this.runGit(repoDir, [
        "--no-optional-locks",
        "status",
        "--porcelain=v2",
        "--branch",
        ...(includeIgnored ? ["--ignored=matching"] : []),
      ]),
      this.runGit(repoDir, [
        "for-each-ref",
        "--format=%(refname)%00%(objectname)%00%(symref)%00%(upstream:short)",
      ]),
      this.runGit(repoDir, ["remote", "-v"]),
      this.runGit(repoDir, [
        "log",
        "-n",
        "10",
        "--pretty=%H%x00%s%x00%ct",
      ]).catch(() => ({ stdout: "", stderr: "" })),
      this.runGit(repoDir, [
        "stash",
        "list",
        "--format=%gd%x00%H%x00%gs%x00%cr",
      ]),
      this.runGit(repoDir, ["rev-parse", "--verify", "HEAD"]).catch(() => ({
        stdout: "",
        stderr: "",
      })),
    ]);
    const parsedStatus = parsePorcelainV2(status.stdout);
    return {
      headOid: head.stdout.trim() || null,
      branch: parsedStatus.branch,
      files: parsedStatus.files,
      refs: refs.stdout
        .split("\n")
        .filter(Boolean)
        .map((line) => {
          const [name = "", target = "", symbolicTarget = "", upstream = ""] =
            line.split("\0");
          return {
            name,
            ...(target ? { target } : {}),
            ...(symbolicTarget ? { symbolicTarget } : {}),
            ...(upstream ? { upstream } : {}),
          };
        }),
      remotes: parseRemoteLines(remotes.stdout),
      recentCommits: recent.stdout
        .split("\n")
        .filter(Boolean)
        .map((line) => {
          const [oid = "", subject = "", timestamp = "0"] = line.split("\0");
          return {
            hash: oid.slice(0, 7),
            subject,
            relativeDate: relativeDate(Number(timestamp), Date.now()),
          };
        }),
      stashes: parseStashList(stashes.stdout),
    };
  }

  async isAncestor(
    repoDir: string,
    ancestor: string,
    descendant: string,
  ): Promise<boolean> {
    try {
      await this.runGit(repoDir, [
        "merge-base",
        "--is-ancestor",
        ancestor,
        descendant,
      ]);
      return true;
    } catch (error) {
      if (error instanceof GitCommandError && error.code === 1) return false;
      throw error;
    }
  }

  async resolveRevision(repoDir: string, revision: string): Promise<string> {
    return (
      await this.runGit(repoDir, ["rev-parse", "--verify", revision])
    ).stdout.trim();
  }

  async validateBranchName(name: string): Promise<boolean> {
    try {
      await this.runGit(process.cwd(), ["check-ref-format", "--branch", name]);
      return true;
    } catch (error) {
      if (error instanceof GitCommandError && error.code === 1) return false;
      throw error;
    }
  }

  async fileDiff(
    repoDir: string,
    original: NativeGitDocumentSource,
    modified: NativeGitDocumentSource,
  ): Promise<NativeGitFileDiff> {
    const [originalDocument, modifiedDocument] = await Promise.all([
      this.readDocument(repoDir, original),
      this.readDocument(repoDir, modified),
    ]);
    return { original: originalDocument, modified: modifiedDocument };
  }

  private async readDocument(
    repoDir: string,
    source: NativeGitDocumentSource,
  ): Promise<NativeGitFileDiff["original"]> {
    let content: string;
    if (source.kind === "empty") content = "";
    else if (source.kind === "index") {
      content = (await this.runGit(repoDir, ["show", `:${source.path}`]))
        .stdout;
    } else if (source.kind === "revision") {
      content = (
        await this.runGit(repoDir, [
          "show",
          `${source.revision ?? "HEAD"}:${source.path}`,
        ])
      ).stdout;
    } else {
      const root = resolve(repoDir);
      const target = resolve(root, source.path);
      if (target === root || !target.startsWith(`${root}${sep}`)) {
        throw new NativeGitReadError(
          "invalid_input",
          "Git file path is outside the repository directory.",
        );
      }
      content = await readFile(target, "utf8");
    }
    return {
      ...(content.includes("\0") ? {} : { content }),
      binary: content.includes("\0"),
      size: Buffer.byteLength(content),
    };
  }
}

export type GitReadBackendObservation = {
  backend: "native" | "cli-compatibility";
  operation: string;
  durationMs: number;
  succeeded: boolean;
  fallbackCategory?: "unsupported";
};

export class GitReadBackendRouter implements GitReadBackend {
  constructor(
    private readonly native: GitReadBackend,
    private readonly compatibility: GitReadBackend,
    private readonly observe?: (observation: GitReadBackendObservation) => void,
  ) {}

  async isRepository(repoDir: string): Promise<boolean> {
    try {
      return await this.withFallback("repository-info", (backend) =>
        backend.isRepository(repoDir),
      );
    } catch (error) {
      if (
        error instanceof NativeGitReadError &&
        error.category === "not_repository"
      ) {
        return false;
      }
      throw error;
    }
  }

  async snapshot(
    repoDir: string,
    includeIgnored?: boolean,
  ): Promise<GitReadSnapshot> {
    return this.withFallback("snapshot", (backend) =>
      backend.snapshot(repoDir, includeIgnored),
    );
  }

  async isAncestor(
    repoDir: string,
    ancestor: string,
    descendant: string,
  ): Promise<boolean> {
    return this.withFallback("ancestry", (backend) =>
      backend.isAncestor(repoDir, ancestor, descendant),
    );
  }

  async resolveRevision(repoDir: string, revision: string): Promise<string> {
    return this.withFallback("resolve-revision", (backend) =>
      backend.resolveRevision(repoDir, revision),
    );
  }

  async validateBranchName(name: string): Promise<boolean> {
    return this.withFallback("validate-branch", (backend) =>
      backend.validateBranchName(name),
    );
  }

  async fileDiff(
    repoDir: string,
    original: NativeGitDocumentSource,
    modified: NativeGitDocumentSource,
  ): Promise<NativeGitFileDiff> {
    return this.withFallback("file-diff", (backend) =>
      backend.fileDiff(repoDir, original, modified),
    );
  }

  private async withFallback<T>(
    operation: string,
    invoke: (backend: GitReadBackend) => Promise<T>,
  ): Promise<T> {
    const startedAt = performance.now();
    try {
      const result = await invoke(this.native);
      this.report({
        backend: "native",
        operation,
        durationMs: performance.now() - startedAt,
        succeeded: true,
      });
      return result;
    } catch (error) {
      this.report({
        backend: "native",
        operation,
        durationMs: performance.now() - startedAt,
        succeeded: false,
        ...(isUnsupportedNativeGitRead(error)
          ? { fallbackCategory: "unsupported" as const }
          : {}),
      });
      if (!isUnsupportedNativeGitRead(error)) throw error;
      return this.runCompatibility(operation, invoke);
    }
  }

  private async runCompatibility<T>(
    operation: string,
    invoke: (backend: GitReadBackend) => Promise<T>,
  ): Promise<T> {
    const startedAt = performance.now();
    try {
      const result = await invoke(this.compatibility);
      this.report({
        backend: "cli-compatibility",
        operation,
        durationMs: performance.now() - startedAt,
        succeeded: true,
        fallbackCategory: "unsupported",
      });
      return result;
    } catch (error) {
      this.report({
        backend: "cli-compatibility",
        operation,
        durationMs: performance.now() - startedAt,
        succeeded: false,
        fallbackCategory: "unsupported",
      });
      throw error;
    }
  }

  private report(observation: GitReadBackendObservation): void {
    try {
      this.observe?.(observation);
    } catch {
      // Diagnostics must never affect Git reads.
    }
  }
}

export function isUnsupportedNativeGitRead(
  error: unknown,
): error is NativeGitReadError {
  return (
    error instanceof NativeGitReadError && error.category === "unsupported"
  );
}

function parseRemoteLines(output: string): GitReadRemote[] {
  const remotes = new Map<string, GitReadRemote>();
  for (const line of output.split("\n")) {
    const match = /^(\S+)\s+(\S+)\s+\((fetch|push)\)$/.exec(line);
    if (!match) continue;
    const [, name = "", url = "", direction] = match;
    const remote = remotes.get(name) ?? { name };
    if (direction === "fetch") remote.fetchUrl = url;
    else remote.pushUrl = url;
    remotes.set(name, remote);
  }
  return [...remotes.values()].sort((left, right) =>
    left.name.localeCompare(right.name),
  );
}

function statusCode(value: string): GitFileChange["index"] {
  switch (value) {
    case "M":
    case "A":
    case "D":
    case "R":
    case "C":
    case "U":
    case "?":
    case "!":
    case " ":
      return value;
    default:
      return " ";
  }
}

function relativeDate(timestampSeconds: number, nowMs: number): string {
  const elapsed = Math.max(0, Math.floor(nowMs / 1_000 - timestampSeconds));
  if (elapsed < 90) return `${Math.max(1, elapsed)} seconds ago`;
  const minutes = Math.floor(elapsed / 60);
  if (minutes < 90) return `${minutes} minutes ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 36) return `${hours} hours ago`;
  const days = Math.floor(hours / 24);
  if (days < 14) return `${days} days ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 10) return `${weeks} weeks ago`;
  const months = Math.floor(days / 30);
  if (months < 18) return `${months} months ago`;
  return `${Math.floor(days / 365)} years ago`;
}
