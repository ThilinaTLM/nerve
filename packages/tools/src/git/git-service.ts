import { type Dirent, existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { basename, join, resolve, sep } from "node:path";
import type {
  GitBranchListResponse,
  GitDiscoveryResponse,
  GithubPrCheckoutResponse,
  GithubPrDetail,
  GithubPrListFilters,
  GithubPrListResponse,
  GithubStatusResponse,
  GitMutationResponse,
  GitOverviewResponse,
  GitRecentCommit,
  GitRepoSummary,
} from "@nervekit/contracts";
import {
  branchExists as branchExistsImpl,
  comparisonBaseRef as comparisonBaseRefImpl,
  detectBaseBranch as detectBaseBranchImpl,
  listBranches as listBranchesImpl,
  mergedToBase as mergedToBaseImpl,
} from "./git-branches.js";
import {
  type ExecResult,
  GitCommandError,
  runGitCommand,
} from "./git-command.js";
import { GitWorkflowError } from "./git-errors.js";
import { isGithubRemoteUrl, parseGitRemoteUrls } from "./git-github-parsers.js";
import {
  checkoutPr as checkoutGithubPr,
  type GithubServiceContext,
  prDetail as getGithubPrDetail,
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
import { parsePorcelainV2 } from "./git-status.js";

const MAX_DISCOVERY_DEPTH = 2;
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", ".next"]);

export class GitService {
  readonly #stableMetadataCache: GitRepositoryMetadataCache;

  constructor(
    readonly getProject: (projectId: string) => GitWorkspaceRef,
    readonly options: GitServiceOptions = {},
  ) {
    this.#stableMetadataCache = new GitRepositoryMetadataCache(
      this,
      options.stableMetadataTtlMs ?? 30_000,
      options.now ?? Date.now,
    );
  }

  static forWorkspace(rootDir: string, name = basename(rootDir)): GitService {
    return new GitService(() => ({ dir: rootDir, name }));
  }

  async run(
    bin: "git" | "gh",
    cwd: string,
    args: string[],
  ): Promise<ExecResult> {
    const startedAt = performance.now();
    try {
      const result = await runGitCommand(bin, cwd, args);
      this.observeCommand({
        bin,
        command: args[0] ?? "unknown",
        durationMs: performance.now() - startedAt,
        succeeded: true,
      });
      return result;
    } catch (error) {
      this.observeCommand({
        bin,
        command: args[0] ?? "unknown",
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

  runGh(cwd: string, args: string[]): Promise<ExecResult> {
    return this.run("gh", cwd, args);
  }

  /** Resolve and contain a repo dir relative to the project dir. */
  resolveRepoDir(projectId: string, relativePath: string): string {
    const project = this.getProject(projectId);
    const root = resolve(project.dir);
    const target = resolve(root, relativePath === "." ? "" : relativePath);
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
      const { stdout } = await this.runGit(dir, [
        "rev-parse",
        "--is-inside-work-tree",
      ]);
      return stdout.trim() === "true";
    } catch {
      return false;
    }
  }

  async repoRemoteState(
    repoDir: string,
  ): Promise<{ hasRemote: boolean; hasGithubRemote: boolean }> {
    try {
      const { stdout } = await this.runGit(repoDir, ["remote", "-v"]);
      const urls = parseGitRemoteUrls(stdout);
      return {
        hasRemote: stdout.trim().length > 0,
        hasGithubRemote: urls.some(isGithubRemoteUrl),
      };
    } catch {
      return { hasRemote: false, hasGithubRemote: false };
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

  async discoverRepos(projectId: string): Promise<GitDiscoveryResponse> {
    const project = this.getProject(projectId);
    const root = resolve(project.dir);

    if (await this.isRepo(root)) {
      return {
        projectIsRepo: true,
        repos: [await this.summarizeRepo(root, ".", project.name)],
      };
    }

    const repoDirs = await this.walkForRepos(root, root, 0);
    const repos: GitRepoSummary[] = [];
    let nextIndex = 0;
    const summarizeNext = async (): Promise<void> => {
      while (nextIndex < repoDirs.length) {
        const dir = repoDirs[nextIndex++];
        if (!dir) continue;
        const relativePath = dir.slice(root.length + 1) || ".";
        try {
          repos.push(
            await this.summarizeRepo(dir, relativePath, basename(dir)),
          );
        } catch {
          // Skip repos we cannot summarize (corrupt/unreadable).
        }
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(4, repoDirs.length) }, async () =>
        summarizeNext(),
      ),
    );
    repos.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
    return { projectIsRepo: false, repos };
  }

  async walkForRepos(
    root: string,
    dir: string,
    depth: number,
  ): Promise<string[]> {
    if (depth > MAX_DISCOVERY_DEPTH) return [];
    let entries: Dirent[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return [];
    }
    const found: string[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith(".") || SKIP_DIRS.has(entry.name)) continue;
      const childDir = join(dir, entry.name);
      if (existsSync(join(childDir, ".git"))) {
        // Identified as a repo; do not descend further into it.
        found.push(childDir);
        continue;
      }
      found.push(...(await this.walkForRepos(root, childDir, depth + 1)));
    }
    return found;
  }

  summarizeRepo(
    repoDir: string,
    relativePath: string,
    name: string,
    statusOutput?: string,
  ): Promise<GitRepoSummary> {
    return getRepoSummary(this, repoDir, relativePath, name, statusOutput);
  }

  repoName(projectId: string, relativePath: string): string {
    if (relativePath === ".") return this.getProject(projectId).name;
    return basename(relativePath);
  }

  async overview(
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
        durationMs: performance.now() - startedAt,
        succeeded,
      });
    }
  }

  recentCommits(repoDir: string): Promise<GitRecentCommit[]> {
    return getRecentCommits(this, repoDir);
  }

  async listBranches(
    projectId: string,
    relativePath: string,
  ): Promise<GitBranchListResponse> {
    return await listBranchesImpl.call(this, projectId, relativePath);
  }
  async detectBaseBranch(repoDir: string): Promise<string> {
    return await detectBaseBranchImpl.call(this, repoDir);
  }
  async branchExists(repoDir: string, name: string): Promise<boolean> {
    return await branchExistsImpl.call(this, repoDir, name);
  }
  async comparisonBaseRef(
    repoDir: string,
    baseBranch: string,
  ): Promise<string> {
    return await comparisonBaseRefImpl.call(this, repoDir, baseBranch);
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
    return await mergedToBaseImpl.call(this, repoDir, baseBranch, state);
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
      await this.runGit(repoDir, [
        "merge-base",
        "--is-ancestor",
        "HEAD",
        baseRef,
      ]);
      return true;
    } catch {
      return false;
    }
  }

  async createBranch(
    projectId: string,
    relativePath: string,
    name: string,
  ): Promise<GitMutationResponse> {
    const repoDir = this.resolveRepoDir(projectId, relativePath);
    try {
      await this.runGit(repoDir, ["check-ref-format", "--branch", name]);
    } catch {
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
  }

  async switchBranch(
    projectId: string,
    relativePath: string,
    name: string,
  ): Promise<GitMutationResponse> {
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
    const args = target.remote ? ["switch", "--track", name] : ["switch", name];
    await this.mapGit(() => this.runGit(repoDir, args));
    this.invalidateStableRepoMetadata(repoDir);
    return {
      repo: await this.summarizeRepo(
        repoDir,
        relativePath,
        this.repoName(projectId, relativePath),
      ),
    };
  }

  async stageFile(
    projectId: string,
    relativePath: string,
    path: string,
  ): Promise<GitMutationResponse> {
    const repoDir = this.resolveRepoDir(projectId, relativePath);
    await this.mapGit(() => this.runGit(repoDir, ["add", "--", path]));
    return {
      repo: await this.summarizeRepo(
        repoDir,
        relativePath,
        this.repoName(projectId, relativePath),
      ),
    };
  }

  async unstageFile(
    projectId: string,
    relativePath: string,
    path: string,
  ): Promise<GitMutationResponse> {
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
  }

  async discardFile(
    projectId: string,
    relativePath: string,
    path: string,
  ): Promise<GitMutationResponse> {
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
    await this.mapGit(() => this.runGit(repoDir, ["clean", "-f", "--", path]));
    return {
      repo: await this.summarizeRepo(
        repoDir,
        relativePath,
        this.repoName(projectId, relativePath),
      ),
    };
  }

  async syncBranch(
    projectId: string,
    relativePath: string,
  ): Promise<GitMutationResponse> {
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
      const { files } = parsePorcelainV2(
        (await this.runGit(repoDir, ["status", "--porcelain=v2"])).stdout,
      );
      if (files.length > 0) {
        throw new GitWorkflowError(
          409,
          "GIT_DIRTY_WORKTREE",
          "Working tree has uncommitted changes. Commit or stash them before syncing.",
        );
      }
      await this.mapGit(() => this.runGit(repoDir, ["pull", "--ff-only"]));
      repo = await this.summarizeRepo(repoDir, relativePath, repoName);
    }

    if ((repo.ahead ?? 0) > 0) {
      await this.mapGit(() => this.runGit(repoDir, ["push"]));
    }

    return {
      repo: await this.summarizeRepo(repoDir, relativePath, repoName),
    };
  }

  async switchBaseAndPull(
    projectId: string,
    relativePath: string,
  ): Promise<GitMutationResponse> {
    const repoDir = this.resolveRepoDir(projectId, relativePath);
    const repo = await this.summarizeRepo(
      repoDir,
      relativePath,
      this.repoName(projectId, relativePath),
    );
    if (repo.dirty) {
      throw new GitWorkflowError(
        409,
        "GIT_DIRTY_WORKTREE",
        "Working tree has uncommitted changes. Commit or stash them before switching branches.",
      );
    }
    if (!repo.hasRemote) {
      throw new GitWorkflowError(
        409,
        "GIT_NO_REMOTE",
        "This repository does not have a remote configured.",
      );
    }

    const stable = await this.stableRepoMetadata(repoDir);
    const baseBranch = stable.baseBranch;
    const localBaseExists = stable.refSnapshot.refs.has(
      `refs/heads/${baseBranch}`,
    );

    if (localBaseExists) {
      await this.mapGit(() => this.runGit(repoDir, ["switch", baseBranch]));
    } else {
      const remoteBaseExists =
        stable.refSnapshot.refs.has(`refs/remotes/origin/${baseBranch}`) ||
        stable.refSnapshot.originHead === `refs/remotes/origin/${baseBranch}`;
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
  }

  async push(
    projectId: string,
    relativePath: string,
  ): Promise<GitMutationResponse> {
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
  }

  async pull(
    projectId: string,
    relativePath: string,
  ): Promise<GitMutationResponse> {
    const repoDir = this.resolveRepoDir(projectId, relativePath);
    if (!(await this.hasUpstream(repoDir))) {
      throw new GitWorkflowError(
        409,
        "GIT_NO_UPSTREAM",
        "Current branch has no upstream to pull from.",
      );
    }
    const { files } = parsePorcelainV2(
      (await this.runGit(repoDir, ["status", "--porcelain=v2"])).stdout,
    );
    if (files.length > 0) {
      throw new GitWorkflowError(
        409,
        "GIT_DIRTY_WORKTREE",
        "Working tree has uncommitted changes. Commit or stash them before pulling.",
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
  }

  async fetch(
    projectId: string,
    relativePath: string,
  ): Promise<GitMutationResponse> {
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

  async prDetail(
    projectId: string,
    relativePath: string,
    number: number,
  ): Promise<GithubPrDetail> {
    return getGithubPrDetail(
      this.githubContext(),
      projectId,
      relativePath,
      number,
    );
  }

  async checkoutPr(
    projectId: string,
    relativePath: string,
    number: number,
  ): Promise<GithubPrCheckoutResponse> {
    return checkoutGithubPr(
      this.githubContext(),
      projectId,
      relativePath,
      number,
    );
  }

  githubContext(): GithubServiceContext {
    return {
      resolveRepoDir: (projectId, relativePath) =>
        this.resolveRepoDir(projectId, relativePath),
      repoRemoteState: async (repoDir) =>
        (await this.stableRepoMetadata(repoDir)).remoteState,
      runGh: (repoDir, args) => this.runGh(repoDir, args),
      runGit: (repoDir, args) => this.runGit(repoDir, args),
      ensureGithubRemote: (repoDir) => this.ensureGithubRemote(repoDir),
      invalidateStableMetadata: (repoDir) =>
        this.invalidateStableRepoMetadata(repoDir),
      mapGh: (fn) => this.mapGh(fn),
      summarizeRepo: (repoDir, relativePath, name) =>
        this.summarizeRepo(repoDir, relativePath, name),
      repoName: (projectId, relativePath) =>
        this.repoName(projectId, relativePath),
      isGitCommandError: (error): error is GitCommandError =>
        error instanceof GitCommandError,
    };
  }

  async mapGit<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      if (error instanceof GitCommandError) {
        throw new GitWorkflowError(409, "GIT_COMMAND_FAILED", error.message);
      }
      throw error;
    }
  }

  async mapGh<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      if (error instanceof GitCommandError) {
        const status = error.code === null ? 503 : 409;
        throw new GitWorkflowError(status, "GH_COMMAND_FAILED", error.message);
      }
      throw error;
    }
  }
}

export { GitCommandError } from "./git-command.js";
export {
  isGithubRemoteUrl,
  parseGithubChecks,
  parseGitRemoteUrls,
  summarizeChecks,
  summarizeStatusCheckRollup,
} from "./git-github-parsers.js";
