import { dirname } from "node:path";
import type { GitMutationResponse } from "@nervekit/contracts/git";
import type { GitMutationContext } from "./git-mutation-context.js";
import { inGitCreationLane, inGitLane } from "./git-operation-context.js";
import { GitWorkflowError } from "./git-errors.js";

export async function syncBranch(
  ctx: GitMutationContext,
  projectId: string,
  relativePath: string,
): Promise<GitMutationResponse> {
  return inGitLane(
    ctx.resolveRepoDir(projectId, relativePath),
    true,
    async () => {
      const repoDir = ctx.resolveRepoDir(projectId, relativePath);
      const repoName = ctx.repoName(projectId, relativePath);
      let repo = await ctx.summarizeRepo(repoDir, relativePath, repoName);
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

      await ctx.mapGit(() => ctx.runGit(repoDir, ["fetch", "--prune"]));
      ctx.invalidateStableRepoMetadata(repoDir);
      repo = await ctx.summarizeRepo(repoDir, relativePath, repoName);

      if (!repo.hasUpstream) {
        await ctx.mapGit(() =>
          ctx.runGit(repoDir, ["push", "-u", "origin", currentBranch]),
        );
        return {
          repo: await ctx.summarizeRepo(repoDir, relativePath, repoName),
        };
      }

      if ((repo.behind ?? 0) > 0) {
        await ctx.mapGit(() => ctx.runGit(repoDir, ["pull", "--ff-only"]));
        repo = await ctx.summarizeRepo(repoDir, relativePath, repoName);
      }

      if ((repo.ahead ?? 0) > 0) {
        await ctx.mapGit(() => ctx.runGit(repoDir, ["push"]));
      }

      return {
        repo: await ctx.summarizeRepo(repoDir, relativePath, repoName),
      };
    },
  );
}

export async function switchBaseAndPull(
  ctx: GitMutationContext,
  projectId: string,
  relativePath: string,
  requestedBaseBranch?: string,
): Promise<GitMutationResponse> {
  return inGitLane(
    ctx.resolveRepoDir(projectId, relativePath),
    true,
    async () => {
      const repoDir = ctx.resolveRepoDir(projectId, relativePath);
      const repo = await ctx.summarizeRepo(
        repoDir,
        relativePath,
        ctx.repoName(projectId, relativePath),
      );
      if (!repo.hasRemote) {
        throw new GitWorkflowError(
          409,
          "GIT_NO_REMOTE",
          "This repository does not have a remote configured.",
        );
      }
      // A linked worktree holds one branch; switching it would move that work
      // onto the base branch. Only the primary checkout goes back to base.
      if (!repo.primaryWorktree) {
        throw new GitWorkflowError(
          409,
          "GIT_LINKED_WORKTREE",
          "Only the primary worktree can switch to the base branch. Remove this worktree instead.",
        );
      }

      if (
        requestedBaseBranch &&
        !(await ctx.validateBranchName(requestedBaseBranch))
      ) {
        throw new GitWorkflowError(
          400,
          "GIT_INVALID_BRANCH_NAME",
          `'${requestedBaseBranch}' is not a valid Git branch name.`,
        );
      }

      const stable = await ctx.stableRepoMetadata(repoDir);
      const baseBranch = requestedBaseBranch ?? stable.baseBranch;
      const localBaseExists = stable.refSnapshot.refs.has(
        `refs/heads/${baseBranch}`,
      );

      if (localBaseExists) {
        await ctx.mapGit(() => ctx.runGit(repoDir, ["switch", baseBranch]));
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
        await ctx.mapGit(() =>
          ctx.runGit(repoDir, ["switch", "--track", `origin/${baseBranch}`]),
        );
      }

      if (!(await hasUpstream(ctx, repoDir))) {
        throw new GitWorkflowError(
          409,
          "GIT_NO_UPSTREAM",
          `Base branch '${baseBranch}' has no upstream to pull from.`,
        );
      }
      await ctx.mapGit(() => ctx.runGit(repoDir, ["pull", "--ff-only"]));
      ctx.invalidateStableRepoMetadata(repoDir);
      return {
        repo: await ctx.summarizeRepo(
          repoDir,
          relativePath,
          ctx.repoName(projectId, relativePath),
        ),
      };
    },
  );
}

export async function push(
  ctx: GitMutationContext,
  projectId: string,
  relativePath: string,
): Promise<GitMutationResponse> {
  return inGitLane(
    ctx.resolveRepoDir(projectId, relativePath),
    true,
    async () => {
      const repoDir = ctx.resolveRepoDir(projectId, relativePath);
      const { stdout: branchOut } = await ctx.runGit(repoDir, [
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
      const args = (await hasUpstream(ctx, repoDir))
        ? ["push"]
        : ["push", "-u", "origin", branch];
      await ctx.mapGit(() => ctx.runGit(repoDir, args));
      ctx.invalidateStableRepoMetadata(repoDir);
      return {
        repo: await ctx.summarizeRepo(
          repoDir,
          relativePath,
          ctx.repoName(projectId, relativePath),
        ),
      };
    },
  );
}

export async function pull(
  ctx: GitMutationContext,
  projectId: string,
  relativePath: string,
): Promise<GitMutationResponse> {
  return inGitLane(
    ctx.resolveRepoDir(projectId, relativePath),
    true,
    async () => {
      const repoDir = ctx.resolveRepoDir(projectId, relativePath);
      if (!(await hasUpstream(ctx, repoDir))) {
        throw new GitWorkflowError(
          409,
          "GIT_NO_UPSTREAM",
          "Current branch has no upstream to pull from.",
        );
      }
      await ctx.mapGit(() => ctx.runGit(repoDir, ["pull", "--ff-only"]));
      ctx.invalidateStableRepoMetadata(repoDir);
      return {
        repo: await ctx.summarizeRepo(
          repoDir,
          relativePath,
          ctx.repoName(projectId, relativePath),
        ),
      };
    },
  );
}

export async function fetch(
  ctx: GitMutationContext,
  projectId: string,
  relativePath: string,
): Promise<GitMutationResponse> {
  return inGitLane(
    ctx.resolveRepoDir(projectId, relativePath),
    true,
    async () => {
      const repoDir = ctx.resolveRepoDir(projectId, relativePath);
      await ctx.mapGit(() => ctx.runGit(repoDir, ["fetch", "--prune"]));
      ctx.invalidateStableRepoMetadata(repoDir);
      return {
        repo: await ctx.summarizeRepo(
          repoDir,
          relativePath,
          ctx.repoName(projectId, relativePath),
        ),
      };
    },
  );
}

export async function clone(
  ctx: GitMutationContext,
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
  const destination = ctx.resolveRepoDir(projectId, relativePath);
  return inGitCreationLane(destination, true, async () => {
    await ctx.mapGit(() =>
      ctx.runGit(dirname(destination), ["clone", "--", remoteUrl, destination]),
    );
    return {
      repo: await ctx.summarizeRepo(
        destination,
        relativePath,
        ctx.repoName(projectId, relativePath),
      ),
    };
  });
}

export async function hasUpstream(
  ctx: GitMutationContext,
  repoDir: string,
): Promise<boolean> {
  try {
    await ctx.runGit(repoDir, [
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
