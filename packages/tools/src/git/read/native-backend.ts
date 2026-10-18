import { realpath } from "node:fs/promises";
import type { GitFileChange } from "@nervekit/contracts/git";
import {
  checkGitAncestry,
  discoverGitRepositories,
  readGitProjectSnapshots,
  NativeOperationError,
  type NativeErrorDetail,
  type NativeGitDocumentSource,
  type NativeGitFileDiff,
  type NativeGitFileStatus,
  type NativeGitProjectRepositoryResult,
  readGitFileDiff,
  readGitRepositoryInfo,
  readGitMetadataSnapshot,
  type NativeGitMetadataSnapshot,
  resolveGitRevision,
  validateGitBranchName,
} from "@nervekit/native";
import type {
  GitReadBackend,
  GitReadSnapshot,
  GitReadMetadataSnapshot,
  GitReadMetadataOptions,
  GitReadProjectRepository,
  GitReadProjectResult,
} from "./types.js";
import {
  inGitLane,
  inGitReadLane,
  currentGitCommandOptions,
  assertGitReadLane,
} from "../git-operation-context.js";
import {
  createGitIsolatedReader,
  type GitIsolatedReader,
} from "./git-isolated-reader.js";
import { GitReadBatcher } from "./git-read-batcher.js";
import { canonicalGitIdentity } from "../git-operation-lanes.js";
import { gitPathKey } from "../git-path-key.js";
import {
  runNativeGitProjectRead,
  runIsolatedGitRead,
} from "./git-native-read-admission.js";

type ProjectApi = Pick<
  typeof import("@nervekit/native"),
  "discoverGitRepositories" | "readGitProjectSnapshots"
>;
export interface NativeGitReadBackendDependencies {
  projectApi?: ProjectApi;
  metadataApi?: Pick<
    typeof import("@nervekit/native"),
    "readGitMetadataSnapshot"
  >;
  isolatedReader?: GitIsolatedReader;
}

export class NativeGitReadBackend implements GitReadBackend {
  readonly #projectApi: ProjectApi;
  readonly #metadataApi: Pick<
    typeof import("@nervekit/native"),
    "readGitMetadataSnapshot"
  >;
  readonly #isolated: GitIsolatedReader;
  readonly #batcher: GitReadBatcher;
  #closed = false;
  readonly #shutdown = new AbortController();
  readonly #work = new Set<Promise<unknown>>();
  constructor(
    private readonly now: () => number = Date.now,
    dependencies: NativeGitReadBackendDependencies = {},
  ) {
    this.#projectApi = dependencies.projectApi ?? {
      discoverGitRepositories,
      readGitProjectSnapshots,
    };
    this.#metadataApi = dependencies.metadataApi ?? { readGitMetadataSnapshot };
    this.#isolated = dependencies.isolatedReader ?? createGitIsolatedReader();
    this.#batcher = new GitReadBatcher((repositories, options) =>
      this.#projectApi.readGitProjectSnapshots(repositories, options),
    );
  }
  async close(): Promise<void> {
    this.#closed = true;
    this.#shutdown.abort();
    const [isolated, batches] = await Promise.allSettled([
      this.#isolated.close(),
      this.#batcher.close(),
      ...this.#work,
    ]);
    if (isolated?.status === "rejected") throw isolated.reason;
    if (batches?.status === "rejected") throw batches.reason;
  }
  private owned<T>(
    run: (signal: AbortSignal) => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    this.assertOpen();
    const combined = AbortSignal.any([
      this.#shutdown.signal,
      ...(signal ? [signal] : []),
    ]);
    const work = Promise.resolve()
      .then(() => {
        combined.throwIfAborted();
        return run(combined);
      })
      .then((value) => {
        combined.throwIfAborted();
        return value;
      });
    this.#work.add(work);
    void work
      .finally(() => {
        this.#work.delete(work);
      })
      .catch(() => {});
    return work;
  }
  private assertOpen(): void {
    if (this.#closed) throw new Error("Git read backend is closed");
  }

  async discoverProject(root: string, signal?: AbortSignal) {
    this.assertOpen();
    return this.owned(
      (combined) =>
        runNativeGitProjectRead(
          (admitted) =>
            this.#projectApi.discoverGitRepositories(root, {
              signal: admitted,
            }),
          combined,
        ),
      signal,
    );
  }

  projectSnapshots(
    repositories: GitReadProjectRepository[],
    includeIgnored = false,
    signal?: AbortSignal,
  ): Promise<GitReadProjectResult[]> {
    return this.owned(
      (combined) =>
        this.readProjectSnapshots(repositories, includeIgnored, combined),
      signal,
    );
  }

  private async readProjectSnapshots(
    repositories: GitReadProjectRepository[],
    includeIgnored: boolean,
    signal: AbortSignal,
  ): Promise<GitReadProjectResult[]> {
    this.assertOpen();
    if (repositories.length > 128)
      throw new NativeOperationError({
        category: "limit_exceeded",
        retryable: false,
        message: "At most 128 repositories per project read.",
      });
    const reads = repositories.map((repository) =>
      inGitReadLane(
        repository.commonDir,
        () =>
          this.readAdmittedProjectSnapshot(repository, includeIgnored, signal),
        signal,
      ).catch((error: unknown): GitReadProjectResult => {
        if (signal.aborted || this.#closed) throw error;
        return { repository, error: projectReadError(error) };
      }),
    );
    // No promise-only cancellation: every acquired lane waits for its own real read.
    const settled = await Promise.allSettled(reads);
    const failed = settled.find((result) => result.status === "rejected");
    if (failed?.status === "rejected") throw failed.reason;
    return settled.map((result) => {
      if (result.status === "rejected") throw result.reason;
      return result.value;
    });
  }

  /** Caller holds this repository's common-dir lane through actual completion.
   * Detailed metadata/status composition must use this single-repository helper,
   * not recursively admit a project batch while holding a workflow lane.
   */
  private async readAdmittedProjectSnapshot(
    repository: GitReadProjectRepository,
    includeIgnored: boolean,
    signal: AbortSignal,
  ): Promise<GitReadProjectResult> {
    signal.throwIfAborted();
    this.assertOpen();
    let result = await this.#batcher.enqueue(
      repository,
      includeIgnored,
      signal,
    );
    signal.throwIfAborted();
    // Only this typed diagnostic authorizes the same-kernel isolated route.
    if (result.error?.category === "isolation_required") {
      const snapshot = await runIsolatedGitRead(
        () => this.#isolated.read(repository, { includeIgnored, signal }),
        signal,
      );
      result = { repository, snapshot };
    }
    signal.throwIfAborted();
    return normalizeProjectResult(result);
  }

  isRepository(repoDir: string): Promise<boolean> {
    return this.owned(async () => {
      const info = await readGitRepositoryInfo(repoDir);
      return !info.bare && info.workDir !== undefined;
    }, currentGitCommandOptions().signal);
  }

  metadata(
    repoDir: string,
    options: GitReadMetadataOptions = {},
  ): Promise<GitReadMetadataSnapshot> {
    const parent = currentGitCommandOptions().signal;
    const signal =
      options.signal && parent
        ? AbortSignal.any([options.signal, parent])
        : (options.signal ?? parent);
    return this.owned(
      (combined) =>
        inGitLane(
          repoDir,
          false,
          () =>
            this.readAdmittedMetadata(repoDir, options, combined, (snapshot) =>
              this.normalizeMetadata(snapshot),
            ),
          { signal: combined },
        ),
      signal,
    );
  }

  private readAdmittedMetadata<T>(
    repoDir: string,
    options: GitReadMetadataOptions,
    signal: AbortSignal,
    consume: (
      metadata: NativeGitMetadataSnapshot,
      signal: AbortSignal,
    ) => T | Promise<T>,
  ): Promise<T> {
    return runNativeGitProjectRead(
      async (admitted) =>
        consume(
          await this.#metadataApi.readGitMetadataSnapshot(repoDir, {
            ...options,
            signal: admitted,
          }),
          admitted,
        ),
      signal,
    );
  }

  private async metadataIdentity(
    repoDir: string,
    metadata: NativeGitMetadataSnapshot,
    signal: AbortSignal,
  ): Promise<{
    metadata: NativeGitMetadataSnapshot;
    repository: GitReadProjectRepository;
  }> {
    if (!metadata.workDir)
      throw new NativeOperationError({
        category: "unsupported",
        retryable: false,
        message: "A worktree is required for Git status.",
      });
    // Keep the native admission permit through post-metadata filesystem identity
    // validation too: uncancellable OS lookups remain bounded to two read heads.
    const identity = await canonicalGitIdentity(repoDir);
    const canonical = async (path: string) => {
      signal.throwIfAborted();
      const actual = await realpath(path);
      signal.throwIfAborted();
      return actual;
    };
    const workDir = await canonical(repoDir);
    const metadataGitDir = await canonical(metadata.gitDir);
    const metadataWorkDir = await canonical(metadata.workDir);
    assertGitReadLane(identity.commonDir);
    if (
      gitPathKey(metadataGitDir) !== gitPathKey(identity.gitDir) ||
      gitPathKey(metadataWorkDir) !== gitPathKey(workDir)
    )
      throw new NativeOperationError({
        category: "io",
        retryable: true,
        message: "Git repository identity changed during read.",
      });
    return {
      metadata,
      repository: { relativePath: ".", workDir, ...identity },
    };
  }

  snapshot(repoDir: string, includeIgnored = false): Promise<GitReadSnapshot> {
    return this.owned(
      (signal) => this.readDetailedSnapshot(repoDir, includeIgnored, signal),
      currentGitCommandOptions().signal,
    );
  }

  private async readDetailedSnapshot(
    repoDir: string,
    includeIgnored: boolean,
    signal: AbortSignal,
  ): Promise<GitReadSnapshot> {
    this.assertOpen();
    // One repository gate spans both actual metadata and status/helper completion.
    // Never invoke the legacy full snapshot as an external-filter probe.
    return inGitLane(
      repoDir,
      false,
      async () => {
        const { metadata, repository } = await this.readAdmittedMetadata(
          repoDir,
          { recentCommitLimit: 10, stashLimit: 1000 },
          signal,
          (snapshot, admitted) =>
            this.metadataIdentity(repoDir, snapshot, admitted),
        );
        signal.throwIfAborted();
        const status = await this.readAdmittedProjectSnapshot(
          repository,
          includeIgnored,
          signal,
        );
        if (status.error) throw new NativeOperationError(status.error);
        if (!status.snapshot)
          throw new NativeOperationError({
            category: "internal",
            retryable: false,
            message: "Repository status was empty.",
          });
        return {
          ...this.normalizeMetadata(metadata),
          headOid: status.snapshot.headOid,
          branch: status.snapshot.branch,
          files: status.snapshot.files,
        };
      },
      { signal },
    );
  }

  private normalizeMetadata(
    snapshot: NativeGitMetadataSnapshot,
  ): GitReadMetadataSnapshot {
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

  isAncestor(
    repoDir: string,
    ancestor: string,
    descendant: string,
  ): Promise<boolean> {
    return this.owned(
      async () =>
        (await checkGitAncestry(repoDir, ancestor, descendant)).isAncestor,
      currentGitCommandOptions().signal,
    );
  }
  resolveRevision(repoDir: string, revision: string): Promise<string> {
    return this.owned(
      () => resolveGitRevision(repoDir, revision),
      currentGitCommandOptions().signal,
    );
  }
  validateBranchName(name: string): Promise<boolean> {
    return this.owned(
      async () => validateGitBranchName(name),
      currentGitCommandOptions().signal,
    );
  }
  fileDiff(
    repoDir: string,
    original: NativeGitDocumentSource,
    modified: NativeGitDocumentSource,
  ): Promise<NativeGitFileDiff> {
    return this.owned(
      () => readGitFileDiff(repoDir, original, modified),
      currentGitCommandOptions().signal,
    );
  }
}

function normalizeProjectResult({
  repository,
  snapshot,
  error,
}: NativeGitProjectRepositoryResult): GitReadProjectResult {
  return {
    repository,
    error,
    snapshot: snapshot
      ? {
          headOid: snapshot.headOid ?? null,
          branch: {
            head: snapshot.branch ?? null,
            detached: snapshot.detached,
            upstream: snapshot.upstream ?? null,
            ahead: snapshot.upstream ? (snapshot.ahead ?? 0) : null,
            behind: snapshot.upstream ? (snapshot.behind ?? 0) : null,
          },
          files: normalizeFiles(snapshot.files),
          counts: snapshot.counts,
          inProgress: snapshot.inProgress,
        }
      : undefined,
  };
}
function projectReadError(error: unknown): NativeErrorDetail {
  if (error instanceof NativeOperationError)
    return {
      category: error.category,
      retryable: error.retryable,
      message: "Repository could not be read.",
    };
  if (
    error instanceof Error &&
    (error.message === "Git operation admission is full" ||
      error.message === "Git operation queue is full")
  )
    return {
      category: "limit_exceeded",
      retryable: true,
      message: "Git read queue is full. Retry after other work finishes.",
    };
  return {
    category: "internal",
    retryable: false,
    message: "Repository could not be read.",
  };
}

function normalizeFiles(files: NativeGitFileStatus[]): GitFileChange[] {
  return files.map((file) => ({
    path: file.path.replace(/\/$/, ""),
    ...(file.renamedFrom ? { renamedFrom: file.renamedFrom } : {}),
    index: statusCode(file.index),
    worktree: statusCode(file.worktree),
    staged: file.index !== " " && file.index !== "?" && file.index !== "!",
    untracked: file.untracked,
  }));
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
