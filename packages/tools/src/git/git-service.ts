import { type Dirent, existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { basename, join, resolve, sep } from "node:path";
import type {
  GitBranchListResponse,
  GitDiscoveryResponse,
  GithubPrCheckoutResponse,
  GithubPrDetail,
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
import { parsePorcelainV2, parseShortstat } from "./git-status.js";

const MAX_DISCOVERY_DEPTH = 2;
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", ".next"]);

export type GitWorkspaceRef = {
  dir: string;
  name: string;
};

export class GitService {
  constructor(readonly getProject: (projectId: string) => GitWorkspaceRef) {}

  static forWorkspace(rootDir: string, name = basename(rootDir)): GitService {
    return new GitService(() => ({ dir: rootDir, name }));
  }

  // --- low-level exec ---

  async run(
    bin: "git" | "gh",
    cwd: string,
    args: string[],
  ): Promise<ExecResult> {
    return runGitCommand(bin, cwd, args);
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
    const hasRemote = await this.runGit(repoDir, ["remote"])
      .then(({ stdout }) => stdout.trim().length > 0)
      .catch(() => false);
    if (!hasRemote) return { hasRemote: false, hasGithubRemote: false };

    try {
      const { stdout } = await this.runGit(repoDir, ["remote", "-v"]);
      return {
        hasRemote: true,
        hasGithubRemote: parseGitRemoteUrls(stdout).some(isGithubRemoteUrl),
      };
    } catch {
      return { hasRemote: true, hasGithubRemote: false };
    }
  }

  async ensureGithubRemote(repoDir: string): Promise<void> {
    const remoteState = await this.repoRemoteState(repoDir);
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

  // --- discovery ---

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
    for (const dir of repoDirs) {
      const relativePath = dir.slice(root.length + 1) || ".";
      try {
        repos.push(await this.summarizeRepo(dir, relativePath, basename(dir)));
      } catch {
        // Skip repos we cannot summarize (corrupt/unreadable).
      }
    }
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

  async summarizeRepo(
    repoDir: string,
    relativePath: string,
    name: string,
  ): Promise<GitRepoSummary> {
    const { stdout } = await this.runGit(repoDir, [
      "status",
      "--porcelain=v2",
      "--branch",
    ]);
    const { branch, files } = parsePorcelainV2(stdout);
    const baseBranch = await this.detectBaseBranch(repoDir);
    const remoteState = await this.repoRemoteState(repoDir);
    const onBaseBranch = branch.head === baseBranch;
    return {
      relativePath,
      absDir: repoDir,
      name,
      isRepo: true,
      currentBranch: branch.head,
      detached: branch.detached,
      ahead: branch.upstream ? (branch.ahead ?? 0) : null,
      behind: branch.upstream ? (branch.behind ?? 0) : null,
      hasUpstream: branch.upstream !== null,
      hasRemote: remoteState.hasRemote,
      hasGithubRemote: remoteState.hasGithubRemote,
      baseBranch,
      onBaseBranch,
      mergedToBase: await this.mergedToBase(repoDir, baseBranch, {
        currentBranch: branch.head,
        detached: branch.detached,
        onBaseBranch,
      }),
      dirty: files.length > 0,
      changeCount: files.length,
    };
  }

  repoName(projectId: string, relativePath: string): string {
    if (relativePath === ".") return this.getProject(projectId).name;
    return basename(relativePath);
  }

  // --- overview ---

  async overview(
    projectId: string,
    relativePath: string,
  ): Promise<GitOverviewResponse> {
    const repoDir = this.resolveRepoDir(projectId, relativePath);
    const repo = await this.summarizeRepo(
      repoDir,
      relativePath,
      this.repoName(projectId, relativePath),
    );

    const { stdout: statusOut } = await this.runGit(repoDir, [
      "status",
      "--porcelain=v2",
    ]);
    const { files } = parsePorcelainV2(statusOut);

    const stagedCount = files.filter((f) => f.staged).length;
    const untrackedCount = files.filter((f) => f.untracked).length;
    const unstagedCount = files.filter(
      (f) => !f.untracked && f.worktree !== " ",
    ).length;

    const unstaged = parseShortstat(
      (await this.runGit(repoDir, ["diff", "--shortstat"])).stdout,
    );
    const staged = parseShortstat(
      (await this.runGit(repoDir, ["diff", "--staged", "--shortstat"])).stdout,
    );

    return {
      repo,
      baseBranch: repo.baseBranch,
      onBaseBranch: repo.onBaseBranch,
      files,
      stagedCount,
      unstagedCount,
      untrackedCount,
      insertions: unstaged.insertions + staged.insertions,
      deletions: unstaged.deletions + staged.deletions,
      recentCommits: await this.recentCommits(repoDir),
    };
  }

  async recentCommits(repoDir: string): Promise<GitRecentCommit[]> {
    try {
      const { stdout } = await this.runGit(repoDir, [
        "log",
        "-n",
        "10",
        "--pretty=%h%x00%s%x00%cr",
      ]);
      return stdout
        .split("\n")
        .filter((line) => line.length > 0)
        .map((line) => {
          const [hash, subject, relativeDate] = line.split("\u0000");
          return {
            hash: hash ?? "",
            subject: subject ?? "",
            relativeDate: relativeDate ?? "",
          };
        });
    } catch {
      return [];
    }
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
  // --- workflow mutations ---

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

    const baseBranch = await this.detectBaseBranch(repoDir);
    const localBaseExists = await this.runGit(repoDir, [
      "rev-parse",
      "--verify",
      "--quiet",
      `refs/heads/${baseBranch}`,
    ]).then(
      () => true,
      () => false,
    );

    if (localBaseExists) {
      await this.mapGit(() => this.runGit(repoDir, ["switch", baseBranch]));
    } else {
      const remoteBaseExists = await this.runGit(repoDir, [
        "rev-parse",
        "--verify",
        "--quiet",
        `refs/remotes/origin/${baseBranch}`,
      ]).then(
        () => true,
        () => false,
      );
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

  // --- GitHub via gh ---

  async githubStatus(
    projectId: string,
    relativePath: string,
  ): Promise<GithubStatusResponse> {
    return getGithubStatus(this.githubContext(), projectId, relativePath);
  }

  async listOpenPrs(
    projectId: string,
    relativePath: string,
  ): Promise<GithubPrListResponse> {
    return listGithubOpenPrs(this.githubContext(), projectId, relativePath);
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
      repoRemoteState: (repoDir) => this.repoRemoteState(repoDir),
      runGh: (repoDir, args) => this.runGh(repoDir, args),
      runGit: (repoDir, args) => this.runGit(repoDir, args),
      ensureGithubRemote: (repoDir) => this.ensureGithubRemote(repoDir),
      mapGh: (fn) => this.mapGh(fn),
      summarizeRepo: (repoDir, relativePath, name) =>
        this.summarizeRepo(repoDir, relativePath, name),
      repoName: (projectId, relativePath) =>
        this.repoName(projectId, relativePath),
      isGitCommandError: (error): error is GitCommandError =>
        error instanceof GitCommandError,
    };
  }

  // --- error mapping ---

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
} from "./git-github-parsers.js";
