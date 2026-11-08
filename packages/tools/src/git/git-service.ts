import {
  backgroundFetch as backgroundFetchImpl,
  type BackgroundFetchResult,
} from "./git-background-fetch.js";
import { readFileDiff, type GitFileDiffContext } from "./git-file-diff.js";
import type { GitMutationContext } from "./git-mutation-context.js";
import {
  createBranch as createBranchImpl,
  deleteBranch as deleteBranchImpl,
  switchBranch as switchBranchImpl,
} from "./git-branch-mutations.js";
import { runObservedCommand } from "./git-observed-runner.js";
import {
  clone as cloneImpl,
  fetch as fetchImpl,
  hasUpstream as hasUpstreamImpl,
  pull as pullImpl,
  push as pushImpl,
  switchBaseAndPull as switchBaseAndPullImpl,
  syncBranch as syncBranchImpl,
} from "./git-remote-operations.js";
import {
  applyStash as applyStashImpl,
  createStash as createStashImpl,
  dropStash as dropStashImpl,
} from "./git-stash-mutations.js";
import {
  discardFile as discardFileImpl,
  stageFile as stageFileImpl,
  unstageFile as unstageFileImpl,
} from "./git-working-tree-mutations.js";
import {
  prSyncAvailability,
  fetchPrSummaries,
  probePullRequests,
  probePrChecks,
} from "./git-github-sync.js";
/* eslint-disable max-lines -- GitService centralizes the repository command boundary and delegates domain workflows to focused modules. */
import { existsSync, realpathSync } from "node:fs";
import { basename, dirname, join, resolve, sep } from "node:path";
import type {
  GitBranchListResponse,
  GitDiffArea,
  GitDiscoveryResponse,
  GitFileDiffResponse,
  GithubPrCheckoutResponse,
  GithubPrChecksResponse,
  GithubPrCommitsResponse,
  GithubPrConversation,
  GithubPrCore,
  GithubPrFileDiffRequest,
  GithubPrFileDiffResponse,
  GithubPrFilesResponse,
  GithubPrInitial,
  GithubPrListFilters,
  GithubPrListResponse,
  GithubPrMergeMethod,
  GithubPrMergeResponse,
  GithubPrOverview,
  GithubStatusResponse,
  GitMutationResponse,
  GitOverviewResponse,
  GitProjectFileStatusResponse,
  GitRecentCommit,
  GitRepoSummary,
  GitStashArea,
} from "@nervekit/contracts/git";
import {
  branchExists as branchExistsImpl,
  comparisonBaseRef as comparisonBaseRefImpl,
  detectBaseBranch as detectBaseBranchImpl,
  listBranches as listBranchesImpl,
  mergedToBase as mergedToBaseImpl,
} from "./git-branches.js";
import {
  type ExecResult,
  type GitCommandOptions,
  GitCommandError,
} from "./git-command.js";
import { GitWorkflowError } from "./git-errors.js";
import { NativeGitReadBackend } from "./read/native-backend.js";
import { ObservedGitReadBackend } from "./read/observed-backend.js";
import type {
  GitReadBackend,
  GitReadMetadataOptions,
  GitReadMetadataSnapshot,
  GitReadSnapshot,
} from "./read/types.js";
import { GithubApiClient } from "./git-github-api-client.js";
import {
  parseGithubRepositoryRemote,
  parseGitRemoteUrls,
} from "./git-github-parsers.js";
import {
  checkoutPr as checkoutGithubPr,
  type GithubServiceContext,
  mergePr as mergeGithubPr,
  prChecks as getGithubPrChecks,
  prCommits as getGithubPrCommits,
  prConversation as getGithubPrConversation,
  prCore as getGithubPrCore,
  prFileDiff as getGithubPrFileDiff,
  prFiles as getGithubPrFiles,
  prInitial as getGithubPrInitial,
  prOverview as getGithubPrOverview,
  githubStatus as getGithubStatus,
  listOpenPrs as listGithubOpenPrs,
} from "./git-github-service.js";
import type {
  GitCommandObservation,
  GitOverviewObservation,
  GitServiceOptions,
  GitWorkspaceRef,
} from "./git-observability.js";
import {
  overview as getOverview,
  recentCommits as getRecentCommits,
  summarizeRepo as getRepoSummary,
} from "./git-overview.js";
import {
  GitRepositoryMetadataCache,
  type StableRepoMetadata,
} from "./git-repository-metadata.js";
import { GitProjectReader } from "./git-project-reader.js";
import { GitOverviewCoalescer } from "./git-overview-coalescer.js";
import { inGitLane, outsideGitOperation } from "./git-operation-context.js";
import { GitRemoteCache } from "./git-remote-cache.js";
import {
  listGithubIssues,
  type GithubIssueSummary,
} from "./git-github-issues.js";

export interface GitRemoteCacheChange {
  projectId: string;
  source: "pull_requests" | "issues";
}

export class GitService {
  readonly #stableMetadataCache: GitRepositoryMetadataCache;
  readonly #githubApi: GithubApiClient;
  readonly #readBackend: GitReadBackend;
  readonly #projectReader: GitProjectReader;
  readonly #overviews: GitOverviewCoalescer<GitOverviewResponse>;
  readonly #summaries: GitOverviewCoalescer<GitRepoSummary>;
  readonly #mutations: GitMutationContext;
  readonly #fileDiffContext: GitFileDiffContext;
  readonly #issues = new GitRemoteCache<GithubIssueSummary[]>();
  readonly #remoteCacheListeners = new Set<
    (change: GitRemoteCacheChange) => void
  >();

  constructor(
    readonly getProject: (projectId: string) => GitWorkspaceRef,
    readonly options: GitServiceOptions = {},
  ) {
    this.#issues.onSettled((key) => this.remoteCacheSettled(key, "issues"));
    this.#stableMetadataCache = new GitRepositoryMetadataCache(
      this,
      options.stableMetadataTtlMs ?? 30_000,
      options.now ?? Date.now,
    );
    this.#readBackend =
      options.readBackend ??
      new ObservedGitReadBackend(
        new NativeGitReadBackend(options.now),
        (observation) => options.onReadCompleted?.(observation),
      );
    this.#projectReader = new GitProjectReader({
      getProject: (projectId) => this.getProject(projectId),
      readBackend: this.#readBackend,
      invalidateProjectReads: (projectId) =>
        this.invalidateProjectReads(projectId),
      summarizeRepo: (...args) => this.summarizeRepo(...args),
    });
    this.#overviews = new GitOverviewCoalescer({
      resolveRepoDir: (projectId, relativePath) =>
        this.resolveRepoDir(projectId, relativePath),
      readOverview: (projectId, relativePath) =>
        this.readOverview(projectId, relativePath),
    });
    this.#summaries = new GitOverviewCoalescer(
      {
        resolveRepoDir: (projectId, relativePath) =>
          this.resolveRepoDir(projectId, relativePath),
        readOverview: (projectId, relativePath) =>
          this.readRepoSummary(projectId, relativePath),
      },
      false,
    );
    this.#mutations = {
      resolveRepoDir: (projectId, relativePath) =>
        this.resolveRepoDir(projectId, relativePath),
      runGit: (cwd, args) => this.runGit(cwd, args),
      mapGit: (fn) => this.mapGit(fn),
      summarizeRepo: (repoDir, relativePath, name) =>
        this.summarizeRepo(repoDir, relativePath, name),
      repoName: (projectId, relativePath) =>
        this.repoName(projectId, relativePath),
      invalidateStableRepoMetadata: (repoDir) =>
        this.invalidateStableRepoMetadata(repoDir),
      stableRepoMetadata: (repoDir) => this.stableRepoMetadata(repoDir),
      listBranches: (projectId, relativePath) =>
        this.listBranches(projectId, relativePath),
      detectBaseBranch: (repoDir) => this.detectBaseBranch(repoDir),
      validateBranchName: (name) => this.#readBackend.validateBranchName(name),
    };
    this.#fileDiffContext = {
      resolveRepoDir: (projectId, relativePath) =>
        this.resolveRepoDir(projectId, relativePath),
      readSnapshot: (repoDir) => this.readSnapshot(repoDir),
      readFileDiff: (repoDir, original, modified) =>
        this.#readBackend.fileDiff(repoDir, original, modified),
    };
    this.#githubApi = new GithubApiClient({
      tokenProvider: async (hostname, signal) =>
        (
          await outsideGitOperation(() =>
            this.run(
              "gh",
              process.cwd(),
              ["auth", "token", "--hostname", hostname],
              { signal },
            ),
          )
        ).stdout,
      now: options.now,
      onRequestCompleted: options.onGithubRequestCompleted,
    });
  }

  static forWorkspace(rootDir: string, name = basename(rootDir)): GitService {
    return new GitService(() => ({ dir: rootDir, name }));
  }

  private async run(
    bin: "git" | "gh",
    cwd: string,
    args: string[],
    commandOptions: GitCommandOptions = {},
  ): Promise<ExecResult> {
    return runObservedCommand(
      (observation) => this.observeCommand(observation),
      bin,
      cwd,
      args,
      commandOptions,
    );
  }

  private observeCommand(observation: GitCommandObservation): void {
    try {
      this.options.onCommandCompleted?.(observation);
    } catch {
      // Diagnostics must never affect Git operations.
    }
  }

  private observeOverview(observation: GitOverviewObservation): void {
    try {
      this.options.onOverviewCompleted?.(observation);
    } catch {
      // Diagnostics must never affect Git operations.
    }
  }

  runGit(cwd: string, args: string[]): Promise<ExecResult> {
    return this.run("git", cwd, args);
  }

  /** Resolve and contain a repo dir relative to the project dir. */
  resolveRepoDir(projectId: string, relativePath: string): string {
    const project = this.getProject(projectId);
    const root = realpathSync(project.dir);
    const lexicalTarget = resolve(
      root,
      relativePath === "." ? "" : relativePath,
    );
    let existing = lexicalTarget;
    const suffix: string[] = [];
    while (!existsSync(existing) && dirname(existing) !== existing) {
      suffix.unshift(basename(existing));
      existing = dirname(existing);
    }
    const target = resolve(realpathSync(existing), ...suffix);
    if (target !== root && !target.startsWith(`${root}${sep}`)) {
      throw new GitWorkflowError(
        400,
        "GIT_REPO_OUT_OF_SCOPE",
        "Repository path is outside the project directory.",
      );
    }
    if (!existsSync(join(target, ".git"))) {
      // .git may be a file (worktrees/submodules) — fall back to git check.
    }
    return target;
  }

  async isRepo(dir: string): Promise<boolean> {
    try {
      return await this.#readBackend.isRepository(dir);
    } catch {
      return false;
    }
  }

  async repoRemoteState(
    repoDir: string,
  ): Promise<StableRepoMetadata["remoteState"]> {
    try {
      const snapshot = await this.readMetadataSnapshot(repoDir);
      const stdout = snapshot.remotes
        .flatMap((remote) => [
          ...(remote.fetchUrl
            ? [`${remote.name}\t${remote.fetchUrl} (fetch)`]
            : []),
          ...(remote.pushUrl
            ? [`${remote.name}\t${remote.pushUrl} (push)`]
            : []),
        ])
        .join("\n");
      const githubRepository = parseGithubRepositoryRemote(stdout);
      return {
        hasRemote: parseGitRemoteUrls(stdout).length > 0,
        hasGithubRemote: githubRepository !== null,
        githubRepository,
      };
    } catch {
      return {
        hasRemote: false,
        hasGithubRemote: false,
        githubRepository: null,
      };
    }
  }

  async ensureGithubRemote(repoDir: string): Promise<void> {
    const remoteState = (await this.stableRepoMetadata(repoDir)).remoteState;
    if (!remoteState.hasRemote) {
      throw new GitWorkflowError(
        409,
        "GH_NO_REMOTE",
        "This repository does not have a remote configured.",
      );
    }
    if (!remoteState.hasGithubRemote) {
      throw new GitWorkflowError(
        409,
        "GH_NO_GITHUB_REMOTE",
        "This repository does not have a GitHub remote configured.",
      );
    }
  }

  stableRepoMetadata(repoDir: string): Promise<StableRepoMetadata> {
    return this.#stableMetadataCache.get(repoDir);
  }

  invalidateStableRepoMetadata(repoDir?: string): void {
    this.#stableMetadataCache.invalidate(repoDir);
  }

  invalidateProjectReads(
    projectId: string,
    options: { uncertain?: boolean } = {},
  ): void {
    this.#projectReader.invalidate(projectId, options);
    this.#overviews.invalidate(projectId, options);
    if (options.uncertain) return;
    try {
      this.#stableMetadataCache.invalidateWithin(
        realpathSync(this.getProject(projectId).dir),
      );
    } catch {
      /* A removed project still invalidates its retained project read generation. */
    }
  }

  /**
   * A change in one repository: only that repository's in-flight reads are
   * superseded. Project-wide caches (discovery, file status) are marked stale
   * without interrupting running reads of other repositories.
   */
  invalidateRepoReads(
    projectId: string,
    relativePath: string,
    options: { uncertain?: boolean } = {},
  ): void {
    let repoDir: string;
    try {
      repoDir = this.resolveRepoDir(projectId, relativePath);
    } catch {
      this.invalidateProjectReads(projectId, options);
      return;
    }
    this.#projectReader.invalidate(projectId, { uncertain: true });
    this.#overviews.invalidate(projectId, options, repoDir);
    this.#summaries.invalidate(projectId, options, repoDir);
    if (!options.uncertain) this.#stableMetadataCache.invalidate(repoDir);
  }

  /** Repository paths (relative to the project) a discovery would report; no status reads. */
  async listRepositoryPaths(projectId: string): Promise<string[]> {
    const root = realpathSync(this.getProject(projectId).dir);
    const discovery = await this.#readBackend.discoverProject(root);
    return discovery.repositories.map((repo) => repo.relativePath).sort();
  }

  discoverRepos(
    projectId: string,
    refresh = false,
  ): Promise<GitDiscoveryResponse> {
    return this.#projectReader.discoverRepos(projectId, refresh);
  }

  projectFileStatus(
    projectId: string,
    refresh = false,
  ): Promise<GitProjectFileStatusResponse> {
    return this.#projectReader.projectFileStatus(projectId, refresh);
  }

  summarizeRepo(
    repoDir: string,
    relativePath: string,
    name: string,
    statusOutput?: string,
    snapshot?: Pick<GitReadSnapshot, "branch" | "files">,
  ): Promise<GitRepoSummary> {
    return getRepoSummary(
      this,
      repoDir,
      relativePath,
      name,
      statusOutput,
      snapshot,
    );
  }

  repoName(projectId: string, relativePath: string): string {
    if (relativePath === ".") return this.getProject(projectId).name;
    return basename(relativePath);
  }

  overview(
    projectId: string,
    relativePath: string,
  ): Promise<GitOverviewResponse> {
    return this.#overviews.overview(projectId, relativePath);
  }

  /**
   * Summary without file list, recent commits or stashes: branch status from
   * one status read, the rest from the cached stable metadata.
   */
  repoSummary(
    projectId: string,
    relativePath: string,
  ): Promise<GitRepoSummary> {
    return this.#summaries.overview(projectId, relativePath);
  }

  private async readRepoSummary(
    projectId: string,
    relativePath: string,
  ): Promise<GitRepoSummary> {
    const repoDir = this.resolveRepoDir(projectId, relativePath);
    const status = await this.#readBackend.statusSnapshot(repoDir);
    return getRepoSummary(
      this,
      repoDir,
      relativePath,
      this.repoName(projectId, relativePath),
      undefined,
      status,
    );
  }

  private async readOverview(
    projectId: string,
    relativePath: string,
  ): Promise<GitOverviewResponse> {
    const startedAt = performance.now();
    let succeeded = false;
    try {
      const result = await getOverview(this, projectId, relativePath);
      succeeded = true;
      return result;
    } finally {
      this.observeOverview({
        projectId,
        relativePath,
        durationMs: performance.now() - startedAt,
        succeeded,
      });
    }
  }

  readMetadataSnapshot(
    repoDir: string,
    options?: GitReadMetadataOptions,
  ): Promise<GitReadMetadataSnapshot> {
    return this.#readBackend.metadata(repoDir, options);
  }

  readSnapshot(
    repoDir: string,
    includeIgnored = false,
  ): Promise<GitReadSnapshot> {
    return this.#readBackend.snapshot(repoDir, includeIgnored);
  }

  readIsAncestor(
    repoDir: string,
    ancestor: string,
    descendant: string,
  ): Promise<boolean> {
    return this.#readBackend.isAncestor(repoDir, ancestor, descendant);
  }

  resolveReadRevision(repoDir: string, revision: string): Promise<string> {
    return this.#readBackend.resolveRevision(repoDir, revision);
  }

  recentCommits(repoDir: string): Promise<GitRecentCommit[]> {
    return getRecentCommits(this, repoDir);
  }

  async listBranches(
    projectId: string,
    relativePath: string,
  ): Promise<GitBranchListResponse> {
    return await listBranchesImpl(this, projectId, relativePath);
  }
  async detectBaseBranch(repoDir: string): Promise<string> {
    return await detectBaseBranchImpl(this, repoDir);
  }
  async branchExists(repoDir: string, name: string): Promise<boolean> {
    return await branchExistsImpl(this, repoDir, name);
  }
  async comparisonBaseRef(
    repoDir: string,
    baseBranch: string,
  ): Promise<string> {
    return await comparisonBaseRefImpl(this, repoDir, baseBranch);
  }
  async mergedToBase(
    repoDir: string,
    baseBranch: string,
    state: {
      currentBranch: string | null;
      detached: boolean;
      onBaseBranch: boolean;
    },
  ): Promise<boolean> {
    return await mergedToBaseImpl(this, repoDir, baseBranch, state);
  }

  async mergedToBaseRef(
    repoDir: string,
    baseRef: string,
    state: {
      currentBranch: string | null;
      detached: boolean;
      onBaseBranch: boolean;
    },
  ): Promise<boolean> {
    if (state.detached || state.onBaseBranch || !state.currentBranch) {
      return false;
    }
    try {
      if (!(await this.#readBackend.isAncestor(repoDir, "HEAD", baseRef))) {
        return false;
      }
      // A branch still at the base tip has no work of its own yet (just created),
      // so it is not "merged".
      const [head, base] = await Promise.all([
        this.#readBackend.resolveRevision(repoDir, "HEAD"),
        this.#readBackend.resolveRevision(repoDir, baseRef),
      ]);
      return head !== base;
    } catch {
      return false;
    }
  }

  /** Commits a first push of the current branch would upload; null when unknown. */
  async unpublishedCommitCount(repoDir: string): Promise<number | null> {
    try {
      return await this.#readBackend.countUnpublishedCommits(repoDir, "origin");
    } catch (error) {
      if (
        error instanceof Error &&
        (error.name === "AbortError" ||
          ("category" in error && error.category === "cancelled"))
      )
        throw error;
      return null;
    }
  }

  async createBranch(
    projectId: string,
    relativePath: string,
    name: string,
  ): Promise<GitMutationResponse> {
    return createBranchImpl(this.#mutations, projectId, relativePath, name);
  }

  async switchBranch(
    projectId: string,
    relativePath: string,
    name: string,
  ): Promise<GitMutationResponse> {
    return switchBranchImpl(this.#mutations, projectId, relativePath, name);
  }

  async deleteBranch(
    projectId: string,
    relativePath: string,
    name: string,
  ): Promise<GitMutationResponse> {
    return deleteBranchImpl(this.#mutations, projectId, relativePath, name);
  }

  async fileDiff(
    projectId: string,
    relativePath: string,
    path: string,
    area: GitDiffArea,
  ): Promise<GitFileDiffResponse> {
    return readFileDiff(
      this.#fileDiffContext,
      projectId,
      relativePath,
      path,
      area,
    );
  }

  async stageFile(
    projectId: string,
    relativePath: string,
    path: string,
  ): Promise<GitMutationResponse> {
    return stageFileImpl(this.#mutations, projectId, relativePath, path);
  }

  async unstageFile(
    projectId: string,
    relativePath: string,
    path: string,
  ): Promise<GitMutationResponse> {
    return unstageFileImpl(this.#mutations, projectId, relativePath, path);
  }

  async discardFile(
    projectId: string,
    relativePath: string,
    path: string,
  ): Promise<GitMutationResponse> {
    return discardFileImpl(this.#mutations, projectId, relativePath, path);
  }

  async createStash(
    projectId: string,
    relativePath: string,
    area: GitStashArea,
    paths?: readonly string[],
  ): Promise<GitMutationResponse> {
    return createStashImpl(
      this.#mutations,
      projectId,
      relativePath,
      area,
      paths,
    );
  }

  async applyStash(
    projectId: string,
    relativePath: string,
    index: number,
    expectedHash: string,
  ): Promise<GitMutationResponse> {
    return applyStashImpl(
      this.#mutations,
      projectId,
      relativePath,
      index,
      expectedHash,
    );
  }

  async dropStash(
    projectId: string,
    relativePath: string,
    index: number,
    expectedHash: string,
  ): Promise<GitMutationResponse> {
    return dropStashImpl(
      this.#mutations,
      projectId,
      relativePath,
      index,
      expectedHash,
    );
  }

  async syncBranch(
    projectId: string,
    relativePath: string,
  ): Promise<GitMutationResponse> {
    return syncBranchImpl(this.#mutations, projectId, relativePath);
  }

  async switchBaseAndPull(
    projectId: string,
    relativePath: string,
    requestedBaseBranch?: string,
  ): Promise<GitMutationResponse> {
    return switchBaseAndPullImpl(
      this.#mutations,
      projectId,
      relativePath,
      requestedBaseBranch,
    );
  }

  async push(
    projectId: string,
    relativePath: string,
  ): Promise<GitMutationResponse> {
    return pushImpl(this.#mutations, projectId, relativePath);
  }

  async pull(
    projectId: string,
    relativePath: string,
  ): Promise<GitMutationResponse> {
    return pullImpl(this.#mutations, projectId, relativePath);
  }

  async fetch(
    projectId: string,
    relativePath: string,
  ): Promise<GitMutationResponse> {
    return fetchImpl(this.#mutations, projectId, relativePath);
  }

  /** Non-interactive background `git fetch`; yields to user remote operations. */
  backgroundFetch(
    projectId: string,
    relativePath: string,
    signal?: AbortSignal,
  ): Promise<BackgroundFetchResult> {
    return backgroundFetchImpl(
      {
        resolveRepoDir: (id, path) => this.resolveRepoDir(id, path),
        run: (cwd, args, options) => this.run("git", cwd, args, options),
        invalidateStableRepoMetadata: (repoDir) =>
          this.invalidateStableRepoMetadata(repoDir),
      },
      projectId,
      relativePath,
      signal,
    );
  }

  async clone(
    projectId: string,
    relativePath: string,
    remoteUrl: string,
  ): Promise<GitMutationResponse> {
    return cloneImpl(this.#mutations, projectId, relativePath, remoteUrl);
  }

  async hasUpstream(repoDir: string): Promise<boolean> {
    return hasUpstreamImpl(this.#mutations, repoDir);
  }

  async githubStatus(
    projectId: string,
    relativePath: string,
  ): Promise<GithubStatusResponse> {
    return getGithubStatus(this.githubContext(), projectId, relativePath);
  }

  prSyncAvailability(projectId: string, repo: string, signal?: AbortSignal) {
    return prSyncAvailability(this.githubContext(), projectId, repo, signal);
  }
  fetchPrSummaries(
    projectId: string,
    repo: string,
    numbers?: number[],
    branches?: string[],
    signal?: AbortSignal,
  ) {
    return fetchPrSummaries(
      this.githubContext(),
      projectId,
      repo,
      numbers,
      branches,
      signal,
    );
  }
  probePullRequests(
    projectId: string,
    repo: string,
    etag?: string,
    signal?: AbortSignal,
  ) {
    return probePullRequests(
      this.githubContext(),
      projectId,
      repo,
      etag,
      signal,
    );
  }
  probePrChecks(
    projectId: string,
    repo: string,
    sha: string,
    etags: { runs?: string; status?: string },
    signal?: AbortSignal,
  ) {
    return probePrChecks(
      this.githubContext(),
      projectId,
      repo,
      sha,
      etags,
      signal,
    );
  }

  async listOpenPrs(
    projectId: string,
    relativePath: string,
    filters: GithubPrListFilters,
  ): Promise<GithubPrListResponse> {
    return listGithubOpenPrs(
      this.githubContext(),
      projectId,
      relativePath,
      filters,
    );
  }

  onRemoteCacheChanged(
    listener: (change: GitRemoteCacheChange) => void,
  ): () => void {
    this.#remoteCacheListeners.add(listener);
    return () => {
      this.#remoteCacheListeners.delete(listener);
    };
  }

  private remoteCacheSettled(
    key: string,
    source: GitRemoteCacheChange["source"],
  ): void {
    const [projectId] = JSON.parse(key) as [string, string];
    for (const listener of [...this.#remoteCacheListeners]) {
      try {
        void Promise.resolve(listener({ projectId, source })).catch(() => {});
      } catch {
        /* Completion invalidation is best effort, never a fetch failure. */
      }
    }
  }

  listIssues(projectId: string, relativePath: string, refresh = false) {
    const cwd = this.resolveRepoDir(projectId, relativePath);
    const snapshot = this.#issues.read(
      JSON.stringify([projectId, cwd]),
      (signal) =>
        inGitLane(cwd, true, () => listGithubIssues(cwd, signal), { signal }),
      refresh,
    );
    return {
      issues: snapshot.value ?? [],
      status: snapshot.status,
      refreshing: snapshot.refreshing,
      updatedAt: snapshot.updatedAt,
      ...(snapshot.failureCode ? { failureCode: snapshot.failureCode } : {}),
    };
  }

  async closeRemoteCaches(): Promise<void> {
    this.#remoteCacheListeners.clear();
    const results = await Promise.allSettled([
      this.#overviews.close(),
      this.#summaries.close(),
      this.#projectReader.close(),
      this.#stableMetadataCache.close(),
      this.#issues.close(),
      this.#githubApi.close(),
      this.#readBackend.close(),
    ]);
    const failed = results.find((result) => result.status === "rejected");
    if (failed?.status === "rejected") throw failed.reason;
  }

  async prInitial(
    projectId: string,
    relativePath: string,
    number: number,
  ): Promise<GithubPrInitial> {
    return getGithubPrInitial(
      this.githubContext(),
      projectId,
      relativePath,
      number,
    );
  }

  async prCore(
    projectId: string,
    relativePath: string,
    number: number,
  ): Promise<GithubPrCore> {
    return getGithubPrCore(
      this.githubContext(),
      projectId,
      relativePath,
      number,
    );
  }

  async prConversation(
    projectId: string,
    relativePath: string,
    number: number,
  ): Promise<GithubPrConversation> {
    return getGithubPrConversation(
      this.githubContext(),
      projectId,
      relativePath,
      number,
    );
  }

  async prOverview(
    projectId: string,
    relativePath: string,
    number: number,
  ): Promise<GithubPrOverview> {
    return getGithubPrOverview(
      this.githubContext(),
      projectId,
      relativePath,
      number,
    );
  }

  async prCommits(
    projectId: string,
    relativePath: string,
    number: number,
  ): Promise<GithubPrCommitsResponse> {
    return getGithubPrCommits(
      this.githubContext(),
      projectId,
      relativePath,
      number,
    );
  }

  async prChecks(
    projectId: string,
    relativePath: string,
    number: number,
  ): Promise<GithubPrChecksResponse> {
    return getGithubPrChecks(
      this.githubContext(),
      projectId,
      relativePath,
      number,
    );
  }

  async prFileDiff(
    projectId: string,
    relativePath: string,
    number: number,
    input: Omit<GithubPrFileDiffRequest, "repo">,
  ): Promise<GithubPrFileDiffResponse> {
    return getGithubPrFileDiff(
      this.githubContext(),
      projectId,
      relativePath,
      number,
      input,
    );
  }

  async prFiles(
    projectId: string,
    relativePath: string,
    number: number,
  ): Promise<GithubPrFilesResponse> {
    return getGithubPrFiles(
      this.githubContext(),
      projectId,
      relativePath,
      number,
    );
  }

  async mergePr(
    projectId: string,
    relativePath: string,
    number: number,
    method: GithubPrMergeMethod,
    expectedHeadOid: string,
  ): Promise<GithubPrMergeResponse> {
    return inGitLane(
      this.resolveRepoDir(projectId, relativePath),
      true,
      async () => {
        return mergeGithubPr(
          this.githubContext(),
          projectId,
          relativePath,
          number,
          method,
          expectedHeadOid,
        );
      },
    );
  }

  async checkoutPr(
    projectId: string,
    relativePath: string,
    number: number,
  ): Promise<GithubPrCheckoutResponse> {
    return inGitLane(
      this.resolveRepoDir(projectId, relativePath),
      true,
      async () => {
        return checkoutGithubPr(
          this.githubContext(),
          projectId,
          relativePath,
          number,
        );
      },
    );
  }

  githubContext(): GithubServiceContext {
    return {
      resolveRepoDir: (projectId, relativePath) =>
        this.resolveRepoDir(projectId, relativePath),
      repoRemoteState: async (repoDir) =>
        (await this.stableRepoMetadata(repoDir)).remoteState,
      githubApi: this.#githubApi,
      runGit: (repoDir, args) => this.runGit(repoDir, args),
      mapGit: (fn) => this.mapGit(fn),
      readSnapshot: (repoDir) => this.readSnapshot(repoDir),
      readMetadataSnapshot: (repoDir) => this.readMetadataSnapshot(repoDir),
      isAncestor: (repoDir, ancestor, descendant) =>
        this.readIsAncestor(repoDir, ancestor, descendant),
      resolveRevision: (repoDir, revision) =>
        this.resolveReadRevision(repoDir, revision),
      ensureGithubRemote: (repoDir) => this.ensureGithubRemote(repoDir),
      invalidateStableMetadata: (repoDir) =>
        this.invalidateStableRepoMetadata(repoDir),
      summarizeRepo: (repoDir, relativePath, name) =>
        this.summarizeRepo(repoDir, relativePath, name),
      repoName: (projectId, relativePath) =>
        this.repoName(projectId, relativePath),
    };
  }

  async mapGit<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      if (error instanceof GitCommandError) {
        throw new GitWorkflowError(409, "GIT_COMMAND_FAILED", error.message, {
          cause: error,
        });
      }
      throw error;
    }
  }
}

export { GitCommandError } from "./git-command.js";
export {
  isGithubRemoteUrl,
  parseGithubChecks,
  parseGithubRepositoryRemote,
  parseGithubRepositoryUrl,
  parseGitRemoteUrls,
  summarizeChecks,
  summarizeStatusCheckRollup,
} from "./git-github-parsers.js";
