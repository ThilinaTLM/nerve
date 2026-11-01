import {
  baseBranchFromRefSnapshot,
  comparisonBaseRefFromSnapshot,
  refSnapshotFromRead,
  type GitRefSnapshot,
} from "./git-branches.js";
import {
  parseGithubRepositoryRemote,
  parseGitRemoteUrls,
  type GithubRepositoryRef,
} from "./git-github-parsers.js";
import {
  currentGitCommandOptions,
  hasGitRepositoryLane,
  outsideGitOperation,
} from "./git-operation-context.js";
import { gitPathKey } from "./git-path-key.js";
import type { GitService } from "./git-service.js";
import type { GitReadMetadataSnapshot } from "./read/types.js";

export type StableRepoMetadata = {
  readonly refSnapshot: GitRefSnapshot;
  readonly baseBranch: string;
  readonly comparisonBaseRef: string;
  readonly hasStash: boolean;
  readonly remoteState: {
    hasRemote: boolean;
    hasGithubRemote: boolean;
    githubRepository: GithubRepositoryRef | null;
  };
};
type CacheEntry = {
  expiresAt: number;
  controller: AbortController;
  work: Promise<StableRepoMetadata>;
  value?: Promise<StableRepoMetadata>;
};

export class GitRepositoryMetadataCache {
  readonly #entries = new Map<string, CacheEntry>();
  readonly #loads = new Set<Promise<StableRepoMetadata>>();
  #closed = false;
  constructor(
    private readonly service: Pick<GitService, "readMetadataSnapshot">,
    private readonly ttlMs: number,
    private readonly now: () => number,
    private readonly limit = 128,
  ) {}

  get(repoDir: string): Promise<StableRepoMetadata> {
    if (this.#closed)
      return Promise.reject(new Error("Git metadata reads are closed"));
    const workflow = currentGitCommandOptions();
    // A workflow owns its lane/cancellation. Never join an unrelated cache job
    // queued behind that lane, or lend this caller's ALS scope to other readers.
    if (hasGitRepositoryLane()) return this.load(repoDir, workflow.signal);
    const entry = this.sharedEntry(repoDir);
    return (entry.value ??= this.follow(repoDir, entry));
  }
  private sharedEntry(repoDir: string): CacheEntry {
    const key = gitPathKey(repoDir);
    const cached = this.#entries.get(key);
    if (cached && cached.expiresAt > this.now()) return cached;
    this.invalidate(repoDir);
    if (this.#entries.size >= this.limit)
      this.remove(this.#entries.keys().next().value!);
    const controller = new AbortController();
    const work = outsideGitOperation(() =>
      this.load(repoDir, controller.signal),
    );
    this.#loads.add(work);
    void work
      .finally(() => {
        this.#loads.delete(work);
      })
      .catch(() => {});
    const entry: CacheEntry = {
      controller,
      expiresAt: Infinity,
      work,
    };
    entry.work = work
      .then((value) => {
        controller.signal.throwIfAborted();
        entry.expiresAt = this.now() + this.ttlMs;
        return value;
      })
      .catch((error: unknown) => {
        if (this.#entries.get(key) === entry) this.#entries.delete(key);
        throw error;
      });
    this.#entries.set(key, entry);
    return entry;
  }
  private async follow(
    repoDir: string,
    entry: CacheEntry,
  ): Promise<StableRepoMetadata> {
    // Follow raw generations, not their public recovery promises: repeated
    // invalidations must not build an ever-growing promise/retry chain.
    for (;;) {
      try {
        const value = await entry.work;
        entry.controller.signal.throwIfAborted();
        return value;
      } catch (error: unknown) {
        const { signal } = entry.controller;
        // Only this cache can abort this controller. Backend AbortErrors and
        // other genuine failures are not supersession, even during invalidation.
        if (this.#closed || !signal.aborted || error !== signal.reason)
          throw error;
        entry = this.sharedEntry(repoDir);
      }
    }
  }
  private remove(key: string): void {
    const previous = this.#entries.get(key);
    this.#entries.delete(key);
    previous?.controller.abort(
      new DOMException("Git metadata superseded", "AbortError"),
    );
  }
  invalidate(repoDir?: string): void {
    if (repoDir) this.remove(gitPathKey(repoDir));
    else for (const key of this.#entries.keys()) this.remove(key);
  }
  invalidateWithin(root: string): void {
    const key = gitPathKey(root);
    const prefix = key.endsWith("/") ? key : `${key}/`;
    for (const path of this.#entries.keys())
      if (path === key || path.startsWith(prefix)) this.remove(path);
  }
  async close(): Promise<void> {
    this.#closed = true;
    this.invalidate();
    await Promise.allSettled([...this.#loads]);
  }
  private async load(
    repoDir: string,
    signal?: AbortSignal,
  ): Promise<StableRepoMetadata> {
    const snapshot = await this.service.readMetadataSnapshot(repoDir, {
      signal,
    });
    signal?.throwIfAborted();
    return stableMetadataFromRead(snapshot);
  }
}

export function stableMetadataFromRead(
  snapshot: Pick<GitReadMetadataSnapshot, "refs" | "branch" | "remotes">,
): StableRepoMetadata {
  const refSnapshot = refSnapshotFromRead(snapshot);
  const remoteOutput = snapshot.remotes
    .flatMap((remote) => [
      ...(remote.fetchUrl
        ? [`${remote.name}\t${remote.fetchUrl} (fetch)`]
        : []),
      ...(remote.pushUrl ? [`${remote.name}\t${remote.pushUrl} (push)`] : []),
    ])
    .join("\n");
  const githubRepository = parseGithubRepositoryRemote(remoteOutput);
  const remoteState = {
    hasRemote: parseGitRemoteUrls(remoteOutput).length > 0,
    hasGithubRemote: githubRepository !== null,
    githubRepository,
  };
  const baseBranch =
    baseBranchFromRefSnapshot(refSnapshot) || (snapshot.branch.head ?? "main");
  return {
    refSnapshot,
    baseBranch,
    comparisonBaseRef: comparisonBaseRefFromSnapshot(refSnapshot, baseBranch),
    hasStash: snapshot.refs.some((ref) => ref.name === "refs/stash"),
    remoteState,
  };
}
