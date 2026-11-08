import { existsSync, realpathSync } from "node:fs";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, sep } from "node:path";
import type { GitMutationResponse } from "@nervekit/contracts/git";
import {
  WORKTREES_DIRECTORY,
  isValidWorktreeId,
  worktreeIdFromBranch,
} from "@nervekit/contracts/git";
import { GitCommandError, GitWorkflowError } from "./git-errors.js";
import type { GitMutationContext } from "./git-mutation-context.js";
import { inGitLane } from "./git-operation-context.js";
import { canonicalGitIdentity } from "./git-operation-lanes.js";
import { repositoryNameFromCommonDir } from "./git-overview.js";
import { gitPathKey } from "./git-path-key.js";

interface WorktreeGroup {
  commonDir: string;
  /** Working directory of the primary checkout (`null` for bare repositories). */
  primaryDir: string | null;
  /** Project-relative path of the primary checkout. */
  primaryRelativePath: string;
  repoName: string;
  multiRepo: boolean;
}

async function resolveGroup(
  ctx: GitMutationContext,
  projectId: string,
  repoDir: string,
): Promise<WorktreeGroup> {
  const { commonDir } = await canonicalGitIdentity(repoDir);
  const key = gitPathKey(commonDir);
  const discovery = await ctx.discoverRepositories(projectId);
  const groups = new Set(
    discovery.map((repo) => gitPathKey(repo.commonDir)).concat(key),
  );
  const primary = discovery.find(
    (repo) =>
      gitPathKey(repo.commonDir) === key &&
      gitPathKey(repo.gitDir) === gitPathKey(repo.commonDir),
  );
  const primaryDir =
    primary?.workDir ??
    (basename(commonDir) === ".git" ? dirname(commonDir) : null);
  let primaryRelativePath = primary?.relativePath;
  if (primaryRelativePath === undefined) {
    const rel = primaryDir
      ? relative(realpathSync(ctx.projectDir(projectId)), primaryDir)
      : "";
    primaryRelativePath =
      rel && !rel.startsWith("..") && !isAbsolute(rel)
        ? rel.split(sep).join("/")
        : ".";
  }
  return {
    commonDir,
    primaryDir,
    primaryRelativePath,
    repoName: primary
      ? ctx.repoName(projectId, primary.relativePath)
      : repositoryNameFromCommonDir(commonDir),
    multiRepo: groups.size > 1,
  };
}

/** Keep `.worktrees/` out of the primary's `git status` without touching tracked files. */
async function ensureExcluded(
  group: WorktreeGroup,
  worktreesDir: string,
): Promise<void> {
  if (!group.primaryDir) return;
  const rel = relative(realpathSync(group.primaryDir), worktreesDir);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) return;
  const pattern = `/${rel.split(sep).join("/")}/`;
  const file = join(group.commonDir, "info", "exclude");
  let current = "";
  try {
    current = await readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  if (current.split(/\r?\n/).some((line) => line.trim() === pattern)) return;
  await mkdir(dirname(file), { recursive: true });
  const prefix = current && !current.endsWith("\n") ? "\n" : "";
  await appendFile(file, `${prefix}${pattern}\n`);
}

function checkedOut(error: unknown): boolean {
  return (
    error instanceof GitCommandError &&
    /already (?:checked out|used by worktree) at/i.test(error.stderr)
  );
}

export async function createWorktree(
  ctx: GitMutationContext,
  projectId: string,
  relativePath: string,
  branch: string,
  id?: string,
): Promise<GitMutationResponse> {
  return inGitLane(
    ctx.resolveRepoDir(projectId, relativePath),
    false,
    async () => {
      const repoDir = ctx.resolveRepoDir(projectId, relativePath);
      if (!(await ctx.validateBranchName(branch))) {
        throw new GitWorkflowError(
          400,
          "GIT_INVALID_BRANCH_NAME",
          `'${branch}' is not a valid git branch name.`,
        );
      }
      const group = await resolveGroup(ctx, projectId, repoDir);
      const worktreeId =
        id ??
        worktreeIdFromBranch(branch, {
          repoName: group.repoName,
          multiRepo: group.multiRepo,
        });
      if (!isValidWorktreeId(worktreeId)) {
        throw new GitWorkflowError(
          400,
          "GIT_INVALID_WORKTREE_ID",
          `'${worktreeId}' is not a valid worktree id.`,
        );
      }
      const worktreeRelativePath = `${WORKTREES_DIRECTORY}/${worktreeId}`;
      const target = ctx.resolveRepoDir(projectId, worktreeRelativePath);
      if (existsSync(target)) {
        throw new GitWorkflowError(
          409,
          "GIT_WORKTREE_EXISTS",
          `A folder named '${worktreeId}' already exists in ${WORKTREES_DIRECTORY}.`,
        );
      }
      const cwd = group.primaryDir ?? repoDir;
      const { branches } = await ctx.listBranches(projectId, relativePath);
      const local = branches.some((b) => !b.remote && b.name === branch);
      const remote = branches.some(
        (b) => b.remote && b.name === `origin/${branch}`,
      );
      let args: string[];
      if (local) {
        args = ["worktree", "add", "--", target, branch];
      } else if (remote) {
        args = [
          "worktree",
          "add",
          "--track",
          "-b",
          branch,
          "--",
          target,
          `origin/${branch}`,
        ];
      } else {
        const base = await ctx.detectBaseBranch(cwd);
        const start = branches.some(
          (b) => b.remote && b.name === `origin/${base}`,
        )
          ? `origin/${base}`
          : base;
        args = ["worktree", "add", "-b", branch, "--", target, start];
      }
      try {
        await ctx.runGit(cwd, args);
      } catch (error) {
        if (checkedOut(error)) {
          throw new GitWorkflowError(
            409,
            "GIT_BRANCH_CHECKED_OUT",
            `Branch '${branch}' is already checked out in another worktree.`,
            { cause: error },
          );
        }
        return ctx.mapGit(() => Promise.reject(error));
      }
      await ensureExcluded(group, dirname(target));
      ctx.invalidateStableRepoMetadata(cwd);
      ctx.invalidateStableRepoMetadata(repoDir);
      return {
        repo: await ctx.summarizeRepo(
          target,
          worktreeRelativePath,
          ctx.repoName(projectId, worktreeRelativePath),
        ),
      };
    },
  );
}

export async function removeWorktree(
  ctx: GitMutationContext,
  projectId: string,
  relativePath: string,
  options: { force: boolean; deleteBranch: boolean },
): Promise<GitMutationResponse> {
  return inGitLane(
    ctx.resolveRepoDir(projectId, relativePath),
    false,
    async () => {
      const repoDir = ctx.resolveRepoDir(projectId, relativePath);
      const { gitDir, commonDir } = await canonicalGitIdentity(repoDir);
      if (gitPathKey(gitDir) === gitPathKey(commonDir)) {
        throw new GitWorkflowError(
          409,
          "GIT_PRIMARY_WORKTREE",
          "The primary worktree cannot be removed.",
        );
      }
      const group = await resolveGroup(ctx, projectId, repoDir);
      if (!group.primaryDir) {
        throw new GitWorkflowError(
          409,
          "GIT_COMMAND_FAILED",
          "The primary worktree of this repository could not be located.",
        );
      }
      const cwd = group.primaryDir;
      const branch = (
        await ctx.runGit(repoDir, ["branch", "--show-current"]).catch(() => ({
          stdout: "",
          stderr: "",
        }))
      ).stdout.trim();
      try {
        await ctx.runGit(cwd, [
          "worktree",
          "remove",
          ...(options.force ? ["--force"] : []),
          "--",
          repoDir,
        ]);
      } catch (error) {
        if (
          error instanceof GitCommandError &&
          /contains modified or untracked files|use --force/i.test(error.stderr)
        ) {
          throw new GitWorkflowError(
            409,
            "GIT_WORKTREE_DIRTY",
            "The worktree has uncommitted changes.",
            { cause: error },
          );
        }
        return ctx.mapGit(() => Promise.reject(error));
      }
      if (options.deleteBranch && branch) {
        const base = await ctx.detectBaseBranch(cwd);
        if (branch !== base) {
          await ctx.mapGit(() =>
            ctx.runGit(cwd, ["branch", "-D", "--", branch]),
          );
        }
      }
      ctx.invalidateStableRepoMetadata(cwd);
      return {
        repo: await ctx.summarizeRepo(
          cwd,
          group.primaryRelativePath,
          ctx.repoName(projectId, group.primaryRelativePath),
        ),
      };
    },
  );
}
