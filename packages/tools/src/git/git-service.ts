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
  runGitCommand,
} from "./git-command.js";
import { GitWorkflowError } from "./git-errors.js";
import { NativeGitReadBackend } from "./read/native-backend.js";
import { ObservedGitReadBackend } from "./read/observed-backend.js";
import type {
  GitReadBackend,
  GitReadMetadataOptions,
  GitReadMetadataSnapshot,
  GitReadSnapshot,
  GitReadDiscovery,
  GitReadProjectResult,
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
import {
  createAreaStash,
  stashApplyArgs,
  verifyStashTarget,
} from "./git-stash.js";
import { parsePorcelainV2 } from "./git-status.js";
import { GitProjectReadCache } from "./read/project-read-cache.js";
import {
  inGitLane,
  inGitCreationLane,
  currentGitCommandOptions,
  hasGitRepositoryLane,
  outsideGitOperation,
} from "./git-operation-context.js";
import { GitRemoteCache } from "./git-remote-cache.js";
import {
  listGithubIssues,
  type GithubIssueSummary,
} from "./git-github-issues.js";

function observedCommand(args: readonly string[]): string {
  return args[0] === "--no-optional-locks"
    ? (args[1] ?? "unknown")
    : (args[0] ?? "unknown");
}

export interface GitRemoteCacheChange {
  projectId: string;
  source: "pull_requests" | "issues";
}

export class GitService {
  readonly #stableMetadataCache: GitRepositoryMetadataCache;
  readonly #githubApi: GithubApiClient;
  readonly #readBackend: GitReadBackend;
  readonly #projectReads = new GitProjectReadCache<{
    discovery: GitReadDiscovery;
    snapshots: GitReadProjectResult[];
    signal: AbortSignal;
    freshness: { stale: boolean };
  }>();
  readonly #overviewReads = new Map<
    string,
    {
      projectId: string;
      freshness: { stale: boolean };
      controller: AbortController;
      value: Promise<GitOverviewResponse>;
    }
  >();
  #readsClosed = false;
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
    const startedAt = performance.now();
    try {
      let commandIndex = 0;
      while (args[commandIndex]?.startsWith("-")) {
        const option = args[commandIndex++];
        if (
          option === "-c" ||
          option === "-C" ||
          option === "--git-dir" ||
          option === "--work-tree"
        )
          commandIndex++;
      }
      const verb = args[commandIndex];
      const network =
        bin === "git" &&
        ["fetch", "pull", "push", "clone"].includes(verb ?? "");
      const commandArgs =
        network && !args.includes("--progress")
          ? [
              ...args.slice(0, commandIndex + 1),
              "--progress",
              ...args.slice(commandIndex + 1),
            ]
          : args;
      const execute = () =>
        runGitCommand(bin, cwd, commandArgs, {
          ...currentGitCommandOptions(),
          ...commandOptions,
          network,
        });
      const createsRepository =
        bin === "git" && (verb === "init" || verb === "clone");
      const destination = createsRepository
        ? resolve(cwd, args.at(-1) ?? ".")
        : undefined;
      // Creation reserves the real parent plus basename before .git exists.
      const result = destination
        ? await inGitCreationLane(
            destination,
            network,
            execute,
            currentGitCommandOptions(),
          )
        : bin === "git"
          ? await inGitLane(cwd, network, execute)
          : await execute();
      this.observeCommand({
        bin,
        command: observedCommand(args),
        cwd,
        durationMs: performance.now() - startedAt,
        succeeded: true,
      });
      return result;
    } catch (error) {
      this.observeCommand({
        bin,
        command: observedCommand(args),
        cwd,
        durationMs: performance.now() - startedAt,
        succeeded: false,
      });
      throw error;
    }
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
    this.#projectReads.invalidate(projectId, options);
    for (const read of this.#overviewReads.values()) {
      if (read.projectId !== projectId) continue;
      read.freshness.stale = true;
      if (!options.uncertain)
        read.controller.abort(
          new DOMException("Git overview superseded", "AbortError"),
        );
    }
    if (options.uncertain) return;
    try {
      this.#stableMetadataCache.invalidateWithin(
        realpathSync(this.getProject(projectId).dir),
      );
    } catch {
      /* A removed project still invalidates its retained project read generation. */
    }
  }

  private readProject(projectId: string, refresh = false) {
    const root = realpathSync(this.getProject(projectId).dir);
    if (refresh) this.invalidateProjectReads(projectId);
    return this.#projectReads.get(
      projectId,
      root,
      async (signal, freshness) => {
        const discovery = await this.#readBackend.discoverProject(root, signal);
        signal.throwIfAborted();
        const snapshots = await this.#readBackend.projectSnapshots(
          discovery.repositories,
          true,
          signal,
        );
        signal.throwIfAborted();
        return { discovery, snapshots, signal, freshness };
      },
      refresh,
    );
  }

  async discoverRepos(
    projectId: string,
    refresh = false,
  ): Promise<GitDiscoveryResponse> {
    const project = this.getProject(projectId);
    const { discovery, snapshots, signal, freshness } = await this.readProject(
      projectId,
      refresh,
    );
    const repos: GitRepoSummary[] = [];
    const errors: NonNullable<GitDiscoveryResponse["errors"]> = [];
    let next = 0;
    const summarize = async () => {
      while (next < snapshots.length) {
        const { repository, snapshot, error } = snapshots[next++];
        if (!snapshot) {
          errors.push({
            repo: repository.relativePath,
            category: error?.category ?? "internal",
            message: "Repository could not be read.",
            retryable: error?.retryable ?? true,
          });
          continue;
        }
        try {
          repos.push(
            await this.summarizeRepo(
              repository.workDir,
              repository.relativePath,
              repository.relativePath === "."
                ? project.name
                : basename(repository.workDir),
              undefined,
              {
                ...snapshot,
                files: snapshot.files.filter(
                  (file) => file.index !== "!" && file.worktree !== "!",
                ),
              },
            ),
          );
        } catch {
          errors.push({
            repo: repository.relativePath,
            category: "read",
            message: "Repository metadata could not be read.",
            retryable: true,
          });
        }
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(4, snapshots.length) }, summarize),
    );
    signal.throwIfAborted();
    repos.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
    errors.sort((a, b) => a.repo.localeCompare(b.repo));
    return {
      projectIsRepo: discovery.projectIsRepo,
      repos,
      errors,
      ...(freshness.stale ? { stale: true } : {}),
    };
  }

  async projectFileStatus(
    projectId: string,
    refresh = false,
  ): Promise<GitProjectFileStatusResponse> {
    const { snapshots, signal, freshness } = await this.readProject(
      projectId,
      refresh,
    );
    signal.throwIfAborted();
    const files: GitProjectFileStatusResponse["files"] = [];
    const errors: NonNullable<GitProjectFileStatusResponse["errors"]> = [];
    for (const { repository, snapshot, error } of snapshots) {
      const repo = repository.relativePath;
      if (!snapshot) {
        errors.push({
          repo,
          category: error?.category ?? "internal",
          message: "Repository could not be read.",
          retryable: error?.retryable ?? true,
        });
        continue;
      }
      const prefix = repo === "." ? "" : `${repo}/`;
      for (const file of snapshot.files)
        files.push({
          ...file,
          repo,
          path: `${prefix}${file.path.replace(/\/$/, "")}`,
          ...(file.renamedFrom
            ? { renamedFrom: `${prefix}${file.renamedFrom}` }
            : {}),
        });
    }
    files.sort((a, b) => a.path.localeCompare(b.path));
    errors.sort((a, b) => a.repo.localeCompare(b.repo));
    return { files, errors, ...(freshness.stale ? { stale: true } : {}) };
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
    if (this.#readsClosed)
      return Promise.reject(new Error("Git reads are closed"));
    // Resolve/authorize on every caller; never join a read from a mutation scope.
    const cwd = this.resolveRepoDir(projectId, relativePath);
    if (hasGitRepositoryLane())
      return this.readOverview(projectId, relativePath);
    const key = JSON.stringify([projectId, cwd]);
    const cached = this.#overviewReads.get(key);
    if (cached)
      return cached.controller.signal.aborted
        ? cached.value
            .catch(() => {})
            .then(() => this.overview(projectId, relativePath))
        : cached.value;
    if (this.#overviewReads.size >= 128)
      return Promise.reject(new Error("Git operation queue is full"));
    const freshness = { stale: false };
    const controller = new AbortController();
    const value = inGitLane(
      cwd,
      false,
      () => this.readOverview(projectId, relativePath),
      { signal: controller.signal },
    ).then((result) => ({
      ...result,
      ...(freshness.stale ? { stale: true } : {}),
    }));
    this.#overviewReads.set(key, { projectId, freshness, controller, value });
    void value
      .finally(() => {
        if (this.#overviewReads.get(key)?.value === value)
          this.#overviewReads.delete(key);
      })
      .catch(() => {});
    return value;
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
      return await this.#readBackend.isAncestor(repoDir, "HEAD", baseRef);
    } catch {
      return false;
    }
  }

  async createBranch(
    projectId: string,
    relativePath: string,
    name: string,
  ): Promise<GitMutationResponse> {
    return inGitLane(
      this.resolveRepoDir(projectId, relativePath),
      false,
      async () => {
        const repoDir = this.resolveRepoDir(projectId, relativePath);
        if (!(await this.#readBackend.validateBranchName(name))) {
          throw new GitWorkflowError(
            400,
            "GIT_INVALID_BRANCH_NAME",
            `'${name}' is not a valid git branch name.`,
          );
        }
        await this.mapGit(() => this.runGit(repoDir, ["switch", "-c", name]));
        this.invalidateStableRepoMetadata(repoDir);
        return {
          repo: await this.summarizeRepo(
            repoDir,
            relativePath,
            this.repoName(projectId, relativePath),
          ),
        };
      },
    );
  }

  async switchBranch(
    projectId: string,
    relativePath: string,
    name: string,
  ): Promise<GitMutationResponse> {
    return inGitLane(
      this.resolveRepoDir(projectId, relativePath),
      false,
      async () => {
        const repoDir = this.resolveRepoDir(projectId, relativePath);
        const branches = await this.listBranches(projectId, relativePath);
        const target = branches.branches.find((branch) => branch.name === name);
        if (!target) {
          throw new GitWorkflowError(
            404,
            "GIT_BRANCH_NOT_FOUND",
            `Branch '${name}' was not found.`,
          );
        }
        const args = target.remote
          ? ["switch", "--track", name]
          : ["switch", name];
        await this.mapGit(() => this.runGit(repoDir, args));
        this.invalidateStableRepoMetadata(repoDir);
        return {
          repo: await this.summarizeRepo(
            repoDir,
            relativePath,
            this.repoName(projectId, relativePath),
          ),
        };
      },
    );
  }

  async deleteBranch(
    projectId: string,
    relativePath: string,
    name: string,
  ): Promise<GitMutationResponse> {
    return inGitLane(
      this.resolveRepoDir(projectId, relativePath),
      false,
      async () => {
        const repoDir = this.resolveRepoDir(projectId, relativePath);
        const branches = await this.listBranches(projectId, relativePath);
        const target = branches.branches.find((branch) => branch.name === name);
        if (!target) {
          throw new GitWorkflowError(
            404,
            "GIT_BRANCH_NOT_FOUND",
            `Branch '${name}' was not found.`,
          );
        }
        if (target.remote) {
          throw new GitWorkflowError(
            400,
            "GIT_REMOTE_BRANCH_DELETE_UNSUPPORTED",
            "Only local branches can be deleted.",
          );
        }
        if (target.current) {
          throw new GitWorkflowError(
            409,
            "GIT_CURRENT_BRANCH_DELETE",
            "Switch to another branch before deleting the current branch.",
          );
        }
        const baseBranch = await this.detectBaseBranch(repoDir);
        if (name === baseBranch) {
          throw new GitWorkflowError(
            409,
            "GIT_BASE_BRANCH_DELETE",
            `The base branch '${baseBranch}' cannot be deleted.`,
          );
        }
        await this.mapGit(() =>
          this.runGit(repoDir, ["branch", "--delete", "--", name]),
        );
        this.invalidateStableRepoMetadata(repoDir);
        return {
          repo: await this.summarizeRepo(
            repoDir,
            relativePath,
            this.repoName(projectId, relativePath),
          ),
        };
      },
    );
  }

  async fileDiff(
    projectId: string,
    relativePath: string,
    path: string,
    area: GitDiffArea,
  ): Promise<GitFileDiffResponse> {
    const repoDir = this.resolveRepoDir(projectId, relativePath);
    const snapshot = await this.readSnapshot(repoDir);
    const file = snapshot.files.find(
      (candidate) => candidate.path === path || candidate.renamedFrom === path,
    );
    const resolvedPath = file?.path ?? path;
    const originalPath = file?.renamedFrom ?? resolvedPath;
    const originalMissing =
      area === "staged" ? file?.index === "A" : Boolean(file?.untracked);
    const modifiedMissing =
      area === "staged" ? file?.index === "D" : file?.worktree === "D";
    const documents = await this.#readBackend.fileDiff(
      repoDir,
      originalMissing
        ? { kind: "empty", path: originalPath }
        : area === "staged"
          ? { kind: "revision", revision: "HEAD", path: originalPath }
          : { kind: "index", path: originalPath },
      modifiedMissing
        ? { kind: "empty", path: resolvedPath }
        : area === "staged"
          ? { kind: "index", path: resolvedPath }
          : { kind: "worktree", path: resolvedPath },
    );
    const metadata = {
      path: resolvedPath,
      ...(file?.renamedFrom ? { renamedFrom: file.renamedFrom } : {}),
      area,
    };
    if (documents.original.binary || documents.modified.binary) {
      return { ...metadata, binary: true };
    }
    return {
      ...metadata,
      binary: false,
      original: documents.original.content ?? "",
      modified: documents.modified.content ?? "",
    };
  }

  async stageFile(
    projectId: string,
    relativePath: string,
    path: string,
  ): Promise<GitMutationResponse> {
    return inGitLane(
      this.resolveRepoDir(projectId, relativePath),
      false,
      async () => {
        const repoDir = this.resolveRepoDir(projectId, relativePath);
        await this.mapGit(() => this.runGit(repoDir, ["add", "--", path]));
        return {
          repo: await this.summarizeRepo(
            repoDir,
            relativePath,
            this.repoName(projectId, relativePath),
          ),
        };
      },
    );
  }

  async unstageFile(
    projectId: string,
    relativePath: string,
    path: string,
  ): Promise<GitMutationResponse> {
    return inGitLane(
      this.resolveRepoDir(projectId, relativePath),
      false,
      async () => {
        const repoDir = this.resolveRepoDir(projectId, relativePath);
        await this.mapGit(() =>
          this.runGit(repoDir, ["restore", "--staged", "--", path]),
        );
        return {
          repo: await this.summarizeRepo(
            repoDir,
            relativePath,
            this.repoName(projectId, relativePath),
          ),
        };
      },
    );
  }

  async discardFile(
    projectId: string,
    relativePath: string,
    path: string,
  ): Promise<GitMutationResponse> {
    return inGitLane(
      this.resolveRepoDir(projectId, relativePath),
      false,
      async () => {
        const repoDir = this.resolveRepoDir(projectId, relativePath);
        const before = parsePorcelainV2(
          (await this.runGit(repoDir, ["status", "--porcelain=v2"])).stdout,
        ).files.find((file) => file.path === path || file.renamedFrom === path);

        try {
          await this.runGit(repoDir, ["restore", "--staged", "--", path]);
        } catch {
          // The path may not be staged; continue with worktree cleanup.
        }
        if (!before?.untracked) {
          try {
            await this.runGit(repoDir, ["restore", "--worktree", "--", path]);
          } catch {
            // Newly-added or deleted paths may require git clean instead.
          }
        }
        await this.mapGit(() =>
          this.runGit(repoDir, ["clean", "-f", "--", path]),
        );
        return {
          repo: await this.summarizeRepo(
            repoDir,
            relativePath,
            this.repoName(projectId, relativePath),
          ),
        };
      },
    );
  }

  async createStash(
    projectId: string,
    relativePath: string,
    area: GitStashArea,
    paths?: readonly string[],
  ): Promise<GitMutationResponse> {
    return inGitLane(
      this.resolveRepoDir(projectId, relativePath),
      false,
      async () => {
        const repoDir = this.resolveRepoDir(projectId, relativePath);
        await this.mapGit(() => createAreaStash(this, repoDir, area, paths));
        return {
          repo: await this.summarizeRepo(
            repoDir,
            relativePath,
            this.repoName(projectId, relativePath),
          ),
        };
      },
    );
  }

  async applyStash(
    projectId: string,
    relativePath: string,
    index: number,
    expectedHash: string,
  ): Promise<GitMutationResponse> {
    return inGitLane(
      this.resolveRepoDir(projectId, relativePath),
      false,
      async () => {
        const repoDir = this.resolveRepoDir(projectId, relativePath);
        const ref = await verifyStashTarget(this, repoDir, index, expectedHash);
        await this.mapGit(async () =>
          this.runGit(repoDir, await stashApplyArgs(this, repoDir, ref)),
        );
        return {
          repo: await this.summarizeRepo(
            repoDir,
            relativePath,
            this.repoName(projectId, relativePath),
          ),
        };
      },
    );
  }

  async dropStash(
    projectId: string,
    relativePath: string,
    index: number,
    expectedHash: string,
  ): Promise<GitMutationResponse> {
    return inGitLane(
      this.resolveRepoDir(projectId, relativePath),
      false,
      async () => {
        const repoDir = this.resolveRepoDir(projectId, relativePath);
        const ref = await verifyStashTarget(this, repoDir, index, expectedHash);
        await this.mapGit(() => this.runGit(repoDir, ["stash", "drop", ref]));
        return {
          repo: await this.summarizeRepo(
            repoDir,
            relativePath,
            this.repoName(projectId, relativePath),
          ),
        };
      },
    );
  }

  async syncBranch(
    projectId: string,
    relativePath: string,
  ): Promise<GitMutationResponse> {
    return inGitLane(
      this.resolveRepoDir(projectId, relativePath),
      true,
      async () => {
        const repoDir = this.resolveRepoDir(projectId, relativePath);
        const repoName = this.repoName(projectId, relativePath);
        let repo = await this.summarizeRepo(repoDir, relativePath, repoName);
        if (repo.detached || !repo.currentBranch) {
          throw new GitWorkflowError(
            409,
            "GIT_DETACHED_HEAD",
            "Cannot sync a detached HEAD. Check out a branch first.",
          );
        }
        const currentBranch = repo.currentBranch;
        if (!repo.hasRemote) {
          throw new GitWorkflowError(
            409,
            "GIT_NO_REMOTE",
            "This repository does not have a remote configured.",
          );
        }

        await this.mapGit(() => this.runGit(repoDir, ["fetch", "--prune"]));
        this.invalidateStableRepoMetadata(repoDir);
        repo = await this.summarizeRepo(repoDir, relativePath, repoName);

        if (!repo.hasUpstream) {
          await this.mapGit(() =>
            this.runGit(repoDir, ["push", "-u", "origin", currentBranch]),
          );
          return {
            repo: await this.summarizeRepo(repoDir, relativePath, repoName),
          };
        }

        if ((repo.behind ?? 0) > 0) {
          await this.mapGit(() => this.runGit(repoDir, ["pull", "--ff-only"]));
          repo = await this.summarizeRepo(repoDir, relativePath, repoName);
        }

        if ((repo.ahead ?? 0) > 0) {
          await this.mapGit(() => this.runGit(repoDir, ["push"]));
        }

        return {
          repo: await this.summarizeRepo(repoDir, relativePath, repoName),
        };
      },
    );
  }

  async switchBaseAndPull(
    projectId: string,
    relativePath: string,
    requestedBaseBranch?: string,
  ): Promise<GitMutationResponse> {
    return inGitLane(
      this.resolveRepoDir(projectId, relativePath),
      true,
      async () => {
        const repoDir = this.resolveRepoDir(projectId, relativePath);
        const repo = await this.summarizeRepo(
          repoDir,
          relativePath,
          this.repoName(projectId, relativePath),
        );
        if (!repo.hasRemote) {
          throw new GitWorkflowError(
            409,
            "GIT_NO_REMOTE",
            "This repository does not have a remote configured.",
          );
        }

        if (
          requestedBaseBranch &&
          !(await this.#readBackend.validateBranchName(requestedBaseBranch))
        ) {
          throw new GitWorkflowError(
            400,
            "GIT_INVALID_BRANCH_NAME",
            `'${requestedBaseBranch}' is not a valid Git branch name.`,
          );
        }

        const stable = await this.stableRepoMetadata(repoDir);
        const baseBranch = requestedBaseBranch ?? stable.baseBranch;
        const localBaseExists = stable.refSnapshot.refs.has(
          `refs/heads/${baseBranch}`,
        );

        if (localBaseExists) {
          await this.mapGit(() => this.runGit(repoDir, ["switch", baseBranch]));
        } else {
          const remoteBaseExists =
            stable.refSnapshot.refs.has(`refs/remotes/origin/${baseBranch}`) ||
            stable.refSnapshot.originHead ===
              `refs/remotes/origin/${baseBranch}`;
          if (!remoteBaseExists) {
            throw new GitWorkflowError(
              404,
              "GIT_BRANCH_NOT_FOUND",
              `Base branch '${baseBranch}' was not found locally or on origin.`,
            );
          }
          await this.mapGit(() =>
            this.runGit(repoDir, ["switch", "--track", `origin/${baseBranch}`]),
          );
        }

        if (!(await this.hasUpstream(repoDir))) {
          throw new GitWorkflowError(
            409,
            "GIT_NO_UPSTREAM",
            `Base branch '${baseBranch}' has no upstream to pull from.`,
          );
        }
        await this.mapGit(() => this.runGit(repoDir, ["pull", "--ff-only"]));
        this.invalidateStableRepoMetadata(repoDir);
        return {
          repo: await this.summarizeRepo(
            repoDir,
            relativePath,
            this.repoName(projectId, relativePath),
          ),
        };
      },
    );
  }

  async push(
    projectId: string,
    relativePath: string,
  ): Promise<GitMutationResponse> {
    return inGitLane(
      this.resolveRepoDir(projectId, relativePath),
      true,
      async () => {
        const repoDir = this.resolveRepoDir(projectId, relativePath);
        const { stdout: branchOut } = await this.runGit(repoDir, [
          "rev-parse",
          "--abbrev-ref",
          "HEAD",
        ]);
        const branch = branchOut.trim();
        if (!branch || branch === "HEAD") {
          throw new GitWorkflowError(
            409,
            "GIT_DETACHED_HEAD",
            "Cannot push from a detached HEAD. Check out a branch first.",
          );
        }
        const args = (await this.hasUpstream(repoDir))
          ? ["push"]
          : ["push", "-u", "origin", branch];
        await this.mapGit(() => this.runGit(repoDir, args));
        this.invalidateStableRepoMetadata(repoDir);
        return {
          repo: await this.summarizeRepo(
            repoDir,
            relativePath,
            this.repoName(projectId, relativePath),
          ),
        };
      },
    );
  }

  async pull(
    projectId: string,
    relativePath: string,
  ): Promise<GitMutationResponse> {
    return inGitLane(
      this.resolveRepoDir(projectId, relativePath),
      true,
      async () => {
        const repoDir = this.resolveRepoDir(projectId, relativePath);
        if (!(await this.hasUpstream(repoDir))) {
          throw new GitWorkflowError(
            409,
            "GIT_NO_UPSTREAM",
            "Current branch has no upstream to pull from.",
          );
        }
        await this.mapGit(() => this.runGit(repoDir, ["pull", "--ff-only"]));
        this.invalidateStableRepoMetadata(repoDir);
        return {
          repo: await this.summarizeRepo(
            repoDir,
            relativePath,
            this.repoName(projectId, relativePath),
          ),
        };
      },
    );
  }

  async fetch(
    projectId: string,
    relativePath: string,
  ): Promise<GitMutationResponse> {
    return inGitLane(
      this.resolveRepoDir(projectId, relativePath),
      true,
      async () => {
        const repoDir = this.resolveRepoDir(projectId, relativePath);
        await this.mapGit(() => this.runGit(repoDir, ["fetch", "--prune"]));
        this.invalidateStableRepoMetadata(repoDir);
        return {
          repo: await this.summarizeRepo(
            repoDir,
            relativePath,
            this.repoName(projectId, relativePath),
          ),
        };
      },
    );
  }

  async clone(
    projectId: string,
    relativePath: string,
    remoteUrl: string,
  ): Promise<GitMutationResponse> {
    if (
      !remoteUrl.trim() ||
      remoteUrl.length > 4096 ||
      /[\0\r\n]/.test(remoteUrl)
    )
      throw new GitWorkflowError(
        400,
        "GIT_INVALID_REMOTE",
        "Invalid clone remote.",
      );
    const destination = this.resolveRepoDir(projectId, relativePath);
    return inGitCreationLane(destination, true, async () => {
      await this.mapGit(() =>
        this.runGit(dirname(destination), [
          "clone",
          "--",
          remoteUrl,
          destination,
        ]),
      );
      return {
        repo: await this.summarizeRepo(
          destination,
          relativePath,
          this.repoName(projectId, relativePath),
        ),
      };
    });
  }

  async hasUpstream(repoDir: string): Promise<boolean> {
    try {
      await this.runGit(repoDir, [
        "rev-parse",
        "--abbrev-ref",
        "--symbolic-full-name",
        "@{u}",
      ]);
      return true;
    } catch {
      return false;
    }
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
    this.#readsClosed = true;
    for (const read of this.#overviewReads.values())
      read.controller.abort(
        new DOMException("Git reads are closed", "AbortError"),
      );
    this.#remoteCacheListeners.clear();
    const results = await Promise.allSettled([
      ...[...this.#overviewReads.values()].map((read) =>
        read.value.catch(() => {}),
      ),
      this.#projectReads.close(),
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
