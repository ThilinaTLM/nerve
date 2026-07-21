import {
  baseBranchFromRefSnapshot,
  comparisonBaseRefFromSnapshot,
  readRefSnapshot,
  type GitRefSnapshot,
} from "./git-branches.js";
import type { GitService } from "./git-service.js";

export type StableRepoMetadata = {
  readonly refSnapshot: GitRefSnapshot;
  readonly baseBranch: string;
  readonly comparisonBaseRef: string;
  readonly remoteState: { hasRemote: boolean; hasGithubRemote: boolean };
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
    const [refSnapshot, remoteState] = await Promise.all([
      readRefSnapshot.call(this.service, repoDir),
      this.service.repoRemoteState(repoDir),
    ]);
    let baseBranch = baseBranchFromRefSnapshot(refSnapshot);
    if (!baseBranch) {
      try {
        const { stdout } = await this.service.runGit(repoDir, [
          "rev-parse",
          "--abbrev-ref",
          "HEAD",
        ]);
        baseBranch = stdout.trim() || "main";
      } catch {
        baseBranch = "main";
      }
    }
    return {
      refSnapshot,
      baseBranch,
      comparisonBaseRef: comparisonBaseRefFromSnapshot(refSnapshot, baseBranch),
      remoteState,
    };
  }
}
