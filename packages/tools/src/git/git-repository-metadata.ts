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
import type { GitService } from "./git-service.js";

export type StableRepoMetadata = {
  readonly refSnapshot: GitRefSnapshot;
  readonly baseBranch: string;
  readonly comparisonBaseRef: string;
  readonly remoteState: {
    hasRemote: boolean;
    hasGithubRemote: boolean;
    githubRepository: GithubRepositoryRef | null;
  };
};

type CacheEntry = {
  readonly expiresAt: number;
  readonly value: Promise<StableRepoMetadata>;
};

export class GitRepositoryMetadataCache {
  readonly #entries = new Map<string, CacheEntry>();

  constructor(
    private readonly service: GitService,
    private readonly ttlMs: number,
    private readonly now: () => number,
  ) {}

  get(repoDir: string): Promise<StableRepoMetadata> {
    const now = this.now();
    const cached = this.#entries.get(repoDir);
    if (cached && cached.expiresAt > now) return cached.value;

    const value = this.#load(repoDir);
    const entry = { expiresAt: now + this.ttlMs, value };
    this.#entries.set(repoDir, entry);
    void value.catch(() => {
      if (this.#entries.get(repoDir) === entry) this.#entries.delete(repoDir);
    });
    return value;
  }

  invalidate(repoDir?: string): void {
    if (repoDir) this.#entries.delete(repoDir);
    else this.#entries.clear();
  }

  async #load(repoDir: string): Promise<StableRepoMetadata> {
    const snapshot = await this.service.readSnapshot(repoDir);
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
    let baseBranch = baseBranchFromRefSnapshot(refSnapshot);
    if (!baseBranch) {
      baseBranch = snapshot.branch.head ?? "main";
    }
    return {
      refSnapshot,
      baseBranch,
      comparisonBaseRef: comparisonBaseRefFromSnapshot(refSnapshot, baseBranch),
      remoteState,
    };
  }
}
