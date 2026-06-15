import { execFile } from "node:child_process";
import { type Dirent, existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { basename, join, resolve, sep } from "node:path";
import { promisify } from "node:util";
import type {
  GitBranchListResponse,
  GitBranchSummary,
  GitDiscoveryResponse,
  GithubChecksSummary,
  GithubPr,
  GithubPrCheckoutResponse,
  GithubPrCommit,
  GithubPrDetail,
  GithubPrFile,
  GithubPrListResponse,
  GithubStatusResponse,
  GitMutationResponse,
  GitOverviewResponse,
  GitRecentCommit,
  GitRepoSummary,
  ProjectRecord,
} from "@nerve/shared";
import { HttpError } from "../../http/errors.js";
import { parsePorcelainV2, parseShortstat } from "./git-status.js";

const execFileAsync = promisify(execFile);

const COMMAND_TIMEOUT_MS = 20_000;
const MAX_BUFFER = 16 * 1024 * 1024;
const MAX_DISCOVERY_DEPTH = 2;
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", ".next"]);
export class GitCommandError extends Error {
  constructor(
    readonly command: string,
    readonly code: number | null,
    readonly stderr: string,
    readonly stdout = "",
  ) {
    super(stderr.trim() || `${command} failed`);
    this.name = "GitCommandError";
  }
}

interface ExecResult {
  stdout: string;
  stderr: string;
}

export class GitService {
  constructor(
    private readonly getProject: (projectId: string) => ProjectRecord,
  ) {}

  // --- low-level exec ---

  private async run(
    bin: "git" | "gh",
    cwd: string,
    args: string[],
  ): Promise<ExecResult> {
    try {
      const { stdout, stderr } = await execFileAsync(bin, args, {
        cwd,
        timeout: COMMAND_TIMEOUT_MS,
        maxBuffer: MAX_BUFFER,
      });
      return { stdout, stderr };
    } catch (error) {
      const err = error as NodeJS.ErrnoException & {
        stdout?: string | Buffer;
        stderr?: string;
        code?: number | string;
      };
      if (err.code === "ENOENT") {
        throw new GitCommandError(bin, null, `${bin} executable not found`);
      }
      const code = typeof err.code === "number" ? err.code : null;
      throw new GitCommandError(
        `${bin} ${args[0] ?? ""}`,
        code,
        err.stderr ?? err.message,
        err.stdout?.toString() ?? "",
      );
    }
  }

  private runGit(cwd: string, args: string[]): Promise<ExecResult> {
    return this.run("git", cwd, args);
  }

  private runGh(cwd: string, args: string[]): Promise<ExecResult> {
    return this.run("gh", cwd, args);
  }

  /** Resolve and contain a repo dir relative to the project dir. */
  private resolveRepoDir(projectId: string, relativePath: string): string {
    const project = this.getProject(projectId);
    const root = resolve(project.dir);
    const target = resolve(root, relativePath === "." ? "" : relativePath);
    if (target !== root && !target.startsWith(`${root}${sep}`)) {
      throw new HttpError(
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

  private async isRepo(dir: string): Promise<boolean> {
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

  private async repoRemoteState(
    repoDir: string,
  ): Promise<{ hasRemote: boolean; hasGithubRemote: boolean }> {
    let hasRemote = false;
    try {
      hasRemote =
        (await this.runGit(repoDir, ["remote"])).stdout.trim().length > 0;
    } catch {
      hasRemote = false;
    }
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

  private async ensureGithubRemote(repoDir: string): Promise<void> {
    const remoteState = await this.repoRemoteState(repoDir);
    if (!remoteState.hasRemote) {
      throw new HttpError(
        409,
        "GH_NO_REMOTE",
        "This repository does not have a remote configured.",
      );
    }
    if (!remoteState.hasGithubRemote) {
      throw new HttpError(
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

  private async walkForRepos(
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

  private async summarizeRepo(
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

  private repoName(projectId: string, relativePath: string): string {
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

  private async recentCommits(repoDir: string): Promise<GitRecentCommit[]> {
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
    const repoDir = this.resolveRepoDir(projectId, relativePath);
    const { stdout } = await this.runGit(repoDir, [
      "for-each-ref",
      "--format=%(refname)%00%(refname:short)%00%(upstream:short)%00%(HEAD)",
      "refs/heads",
      "refs/remotes",
    ]);
    const branches = stdout
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line): GitBranchSummary | null => {
        const [refname, shortName, upstream, head] = line.split("\u0000");
        if (!refname || !shortName) return null;
        if (
          refname.startsWith("refs/remotes/") &&
          shortName.endsWith("/HEAD")
        ) {
          return null;
        }
        return {
          name: shortName,
          current: head === "*",
          remote: refname.startsWith("refs/remotes/"),
          upstream: upstream && upstream.length > 0 ? upstream : null,
        };
      })
      .filter((branch): branch is GitBranchSummary => branch !== null)
      .sort((a, b) => {
        if (a.current !== b.current) return a.current ? -1 : 1;
        if (a.remote !== b.remote) return a.remote ? 1 : -1;
        return a.name.localeCompare(b.name);
      });
    return { branches };
  }

  async detectBaseBranch(repoDir: string): Promise<string> {
    try {
      const { stdout } = await this.runGit(repoDir, [
        "symbolic-ref",
        "--quiet",
        "refs/remotes/origin/HEAD",
      ]);
      const ref = stdout.trim();
      if (ref.startsWith("refs/remotes/origin/")) {
        return ref.slice("refs/remotes/origin/".length);
      }
    } catch {
      // fall through to probing
    }
    for (const candidate of ["main", "master", "develop"]) {
      if (await this.branchExists(repoDir, candidate)) return candidate;
    }
    try {
      const { stdout } = await this.runGit(repoDir, [
        "rev-parse",
        "--abbrev-ref",
        "HEAD",
      ]);
      return stdout.trim() || "main";
    } catch {
      return "main";
    }
  }

  private async branchExists(repoDir: string, name: string): Promise<boolean> {
    try {
      await this.runGit(repoDir, [
        "rev-parse",
        "--verify",
        "--quiet",
        `refs/heads/${name}`,
      ]);
      return true;
    } catch {
      try {
        await this.runGit(repoDir, [
          "rev-parse",
          "--verify",
          "--quiet",
          `refs/remotes/origin/${name}`,
        ]);
        return true;
      } catch {
        return false;
      }
    }
  }

  private async comparisonBaseRef(
    repoDir: string,
    baseBranch: string,
  ): Promise<string> {
    for (const candidate of [
      `refs/remotes/origin/${baseBranch}`,
      `refs/heads/${baseBranch}`,
      baseBranch,
    ]) {
      try {
        await this.runGit(repoDir, [
          "rev-parse",
          "--verify",
          "--quiet",
          `${candidate}^{commit}`,
        ]);
        return candidate;
      } catch {
        // Try the next possible ref.
      }
    }
    return baseBranch;
  }

  private async mergedToBase(
    repoDir: string,
    baseBranch: string,
    state: {
      currentBranch: string | null;
      detached: boolean;
      onBaseBranch: boolean;
    },
  ): Promise<boolean> {
    if (state.detached || state.onBaseBranch || !state.currentBranch) {
      return false;
    }
    const baseRef = await this.comparisonBaseRef(repoDir, baseBranch);
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
      throw new HttpError(
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
      throw new HttpError(
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
    const repo = await this.summarizeRepo(
      repoDir,
      relativePath,
      this.repoName(projectId, relativePath),
    );
    if (repo.detached || !repo.currentBranch) {
      throw new HttpError(
        409,
        "GIT_DETACHED_HEAD",
        "Cannot sync a detached HEAD. Check out a branch first.",
      );
    }
    if (!repo.hasRemote) {
      throw new HttpError(
        409,
        "GIT_NO_REMOTE",
        "This repository does not have a remote configured.",
      );
    }
    if (!repo.hasUpstream) {
      await this.mapGit(() =>
        this.runGit(repoDir, [
          "push",
          "-u",
          "origin",
          repo.currentBranch ?? "",
        ]),
      );
    } else {
      if ((repo.behind ?? 0) > 0) {
        const { files } = parsePorcelainV2(
          (await this.runGit(repoDir, ["status", "--porcelain=v2"])).stdout,
        );
        if (files.length > 0) {
          throw new HttpError(
            409,
            "GIT_DIRTY_WORKTREE",
            "Working tree has uncommitted changes. Commit or stash them before syncing.",
          );
        }
        await this.mapGit(() => this.runGit(repoDir, ["pull", "--ff-only"]));
      }
      if ((repo.ahead ?? 0) > 0) {
        await this.mapGit(() => this.runGit(repoDir, ["push"]));
      }
    }
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
      throw new HttpError(
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
      throw new HttpError(
        409,
        "GIT_NO_UPSTREAM",
        "Current branch has no upstream to pull from.",
      );
    }
    const { files } = parsePorcelainV2(
      (await this.runGit(repoDir, ["status", "--porcelain=v2"])).stdout,
    );
    if (files.length > 0) {
      throw new HttpError(
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

  private async hasUpstream(repoDir: string): Promise<boolean> {
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
    const repoDir = this.resolveRepoDir(projectId, relativePath);
    const remoteState = await this.repoRemoteState(repoDir);
    if (!remoteState.hasRemote) {
      return {
        available: false,
        authenticated: false,
        login: null,
        reason: "No remote repository configured.",
      };
    }
    if (!remoteState.hasGithubRemote) {
      return {
        available: false,
        authenticated: false,
        login: null,
        reason: "Remote repository is not GitHub.",
      };
    }

    try {
      await this.runGh(repoDir, ["--version"]);
    } catch {
      return {
        available: false,
        authenticated: false,
        login: null,
        reason: "GitHub CLI (gh) is not installed.",
      };
    }
    try {
      const { stdout } = await this.runGh(repoDir, [
        "api",
        "user",
        "--jq",
        ".login",
      ]);
      const login = stdout.trim();
      return {
        available: true,
        authenticated: login.length > 0,
        login: login.length > 0 ? login : null,
      };
    } catch (error) {
      return {
        available: true,
        authenticated: false,
        login: null,
        reason:
          error instanceof GitCommandError
            ? "Not authenticated. Run `gh auth login`."
            : "GitHub authentication check failed.",
      };
    }
  }

  async listOpenPrs(
    projectId: string,
    relativePath: string,
  ): Promise<GithubPrListResponse> {
    const repoDir = this.resolveRepoDir(projectId, relativePath);
    await this.ensureGithubRemote(repoDir);
    const { stdout } = await this.mapGh(() =>
      this.runGh(repoDir, [
        "pr",
        "list",
        "--state",
        "open",
        "--limit",
        "50",
        "--json",
        "number,title,url,state,isDraft,headRefName,baseRefName,updatedAt",
      ]),
    );
    const raw = JSON.parse(stdout || "[]") as Array<{
      number: number;
      title: string;
      url: string;
      state: string;
      isDraft: boolean;
      headRefName: string;
      baseRefName: string;
      updatedAt: string;
    }>;
    const prs = await Promise.all(
      raw.map(async (pr): Promise<GithubPr> => {
        const checks = await this.prChecks(repoDir, pr.number);
        return {
          number: pr.number,
          title: pr.title,
          url: pr.url,
          state: pr.state,
          isDraft: pr.isDraft,
          headRefName: pr.headRefName,
          baseRefName: pr.baseRefName,
          updatedAt: pr.updatedAt,
          checks,
        };
      }),
    );
    return { prs };
  }

  private async prChecks(
    repoDir: string,
    number: number,
  ): Promise<GithubChecksSummary> {
    try {
      const { stdout } = await this.runGh(repoDir, [
        "pr",
        "checks",
        String(number),
        "--json",
        "name,state,link",
      ]);
      return parseGithubChecks(stdout);
    } catch (error) {
      if (error instanceof GitCommandError && error.stdout.trim().length > 0) {
        try {
          return parseGithubChecks(error.stdout);
        } catch {
          // Fall through to the no-checks fallback below.
        }
      }
      return noChecksSummary();
    }
  }

  async prDetail(
    projectId: string,
    relativePath: string,
    number: number,
  ): Promise<GithubPrDetail> {
    const repoDir = this.resolveRepoDir(projectId, relativePath);
    await this.ensureGithubRemote(repoDir);
    const { stdout } = await this.mapGh(() =>
      this.runGh(repoDir, [
        "pr",
        "view",
        String(number),
        "--json",
        "number,title,url,state,isDraft,headRefName,baseRefName,updatedAt,createdAt,body,author,additions,deletions,changedFiles,files,commits,mergeable,reviewDecision",
      ]),
    );
    const raw = JSON.parse(stdout || "{}") as {
      number: number;
      title: string;
      url: string;
      state: string;
      isDraft: boolean;
      headRefName: string;
      baseRefName: string;
      updatedAt: string;
      createdAt: string;
      body?: string | null;
      author?: { login?: string } | null;
      additions?: number;
      deletions?: number;
      changedFiles?: number;
      mergeable?: string | null;
      reviewDecision?: string | null;
      files?: Array<{ path: string; additions?: number; deletions?: number }>;
      commits?: Array<{
        oid: string;
        messageHeadline?: string;
        authoredDate?: string;
        authors?: Array<{ name?: string }>;
      }>;
    };
    const checks = await this.prChecks(repoDir, number);
    const files: GithubPrFile[] = (raw.files ?? []).map((file) => ({
      path: file.path,
      additions: file.additions ?? 0,
      deletions: file.deletions ?? 0,
    }));
    const commits: GithubPrCommit[] = (raw.commits ?? []).map((commit) => ({
      oid: commit.oid,
      abbrev: commit.oid.slice(0, 7),
      messageHeadline: commit.messageHeadline ?? "",
      authoredDate: commit.authoredDate,
      authorName: commit.authors?.[0]?.name,
    }));
    return {
      number: raw.number,
      title: raw.title,
      url: raw.url,
      state: raw.state,
      isDraft: raw.isDraft,
      headRefName: raw.headRefName,
      baseRefName: raw.baseRefName,
      updatedAt: raw.updatedAt,
      createdAt: raw.createdAt,
      body: raw.body ?? "",
      author: raw.author?.login ?? null,
      additions: raw.additions ?? 0,
      deletions: raw.deletions ?? 0,
      changedFiles: raw.changedFiles ?? files.length,
      mergeable: raw.mergeable ?? null,
      reviewDecision: raw.reviewDecision ?? null,
      files,
      commits,
      checks,
    };
  }

  async checkoutPr(
    projectId: string,
    relativePath: string,
    number: number,
  ): Promise<GithubPrCheckoutResponse> {
    const repoDir = this.resolveRepoDir(projectId, relativePath);
    await this.ensureGithubRemote(repoDir);
    const { files } = parsePorcelainV2(
      (await this.runGit(repoDir, ["status", "--porcelain=v2"])).stdout,
    );
    if (files.length > 0) {
      throw new HttpError(
        409,
        "GIT_DIRTY_WORKTREE",
        "Working tree has uncommitted changes. Commit or stash them before checking out a PR.",
      );
    }
    await this.mapGh(() =>
      this.runGh(repoDir, ["pr", "checkout", String(number)]),
    );
    return {
      repo: await this.summarizeRepo(
        repoDir,
        relativePath,
        this.repoName(projectId, relativePath),
      ),
      number,
    };
  }

  // --- error mapping ---

  private async mapGit<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      if (error instanceof GitCommandError) {
        throw new HttpError(409, "GIT_COMMAND_FAILED", error.message);
      }
      throw error;
    }
  }

  private async mapGh<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      if (error instanceof GitCommandError) {
        const status = error.code === null ? 503 : 409;
        throw new HttpError(status, "GH_COMMAND_FAILED", error.message);
      }
      throw error;
    }
  }
}

function isGithubHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/\.$/, "");
  return normalized === "github.com" || normalized === "ssh.github.com";
}

export function isGithubRemoteUrl(url: string): boolean {
  const trimmed = url.trim();
  if (trimmed.length === 0) return false;

  try {
    const parsed = new URL(trimmed);
    if (parsed.hostname) return isGithubHost(parsed.hostname);
  } catch {
    // Fall through to SCP-like git remote syntax, e.g.
    // `git@github.com:owner/repo.git`.
  }

  const scpLike = trimmed.match(/^(?:(?:[^@/\s]+)@)?([^:/\s]+):\S+$/);
  return scpLike ? isGithubHost(scpLike[1] ?? "") : false;
}

export function parseGitRemoteUrls(stdout: string): string[] {
  const urls = new Set<string>();
  for (const line of stdout.split("\n")) {
    const match = line.trim().match(/^\S+\s+(.+?)(?:\s+\((?:fetch|push)\))?$/);
    const url = match?.[1]?.trim();
    if (url) urls.add(url);
  }
  return [...urls];
}

type GithubCheckRunRaw = { name: string; state: string; link?: string };

function noChecksSummary(): GithubChecksSummary {
  return {
    status: "none",
    total: 0,
    passed: 0,
    failed: 0,
    pending: 0,
    runs: [],
  };
}

export function parseGithubChecks(stdout: string): GithubChecksSummary {
  const raw = JSON.parse(stdout || "[]") as GithubCheckRunRaw[];
  return summarizeChecks(raw);
}

export function summarizeChecks(
  runs: GithubCheckRunRaw[],
): GithubChecksSummary {
  let passed = 0;
  let failed = 0;
  let pending = 0;
  const normalized = runs.map((run) => {
    const state = run.state.toUpperCase();
    if (["SUCCESS", "NEUTRAL", "SKIPPED"].includes(state)) passed += 1;
    else if (
      [
        "FAILURE",
        "ERROR",
        "CANCELLED",
        "TIMED_OUT",
        "ACTION_REQUIRED",
      ].includes(state)
    )
      failed += 1;
    else pending += 1;
    return {
      name: run.name,
      status: state.toLowerCase(),
      conclusion: state.toLowerCase(),
      url: run.link,
    };
  });
  const total = normalized.length;
  let status: GithubChecksSummary["status"] = "none";
  if (total > 0) {
    if (failed > 0) status = "failing";
    else if (pending > 0) status = "pending";
    else status = "passing";
  }
  return { status, total, passed, failed, pending, runs: normalized };
}
