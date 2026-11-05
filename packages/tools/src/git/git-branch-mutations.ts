import type { GitMutationResponse } from "@nervekit/contracts/git";
import type { GitMutationContext } from "./git-mutation-context.js";
import { inGitLane } from "./git-operation-context.js";
import { GitWorkflowError } from "./git-errors.js";

export async function createBranch(
  ctx: GitMutationContext,
  projectId: string,
  relativePath: string,
  name: string,
): Promise<GitMutationResponse> {
  return inGitLane(
    ctx.resolveRepoDir(projectId, relativePath),
    false,
    async () => {
      const repoDir = ctx.resolveRepoDir(projectId, relativePath);
      if (!(await ctx.validateBranchName(name))) {
        throw new GitWorkflowError(
          400,
          "GIT_INVALID_BRANCH_NAME",
          `'${name}' is not a valid git branch name.`,
        );
      }
      await ctx.mapGit(() => ctx.runGit(repoDir, ["switch", "-c", name]));
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

export async function switchBranch(
  ctx: GitMutationContext,
  projectId: string,
  relativePath: string,
  name: string,
): Promise<GitMutationResponse> {
  return inGitLane(
    ctx.resolveRepoDir(projectId, relativePath),
    false,
    async () => {
      const repoDir = ctx.resolveRepoDir(projectId, relativePath);
      const branches = await ctx.listBranches(projectId, relativePath);
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

export async function deleteBranch(
  ctx: GitMutationContext,
  projectId: string,
  relativePath: string,
  name: string,
): Promise<GitMutationResponse> {
  return inGitLane(
    ctx.resolveRepoDir(projectId, relativePath),
    false,
    async () => {
      const repoDir = ctx.resolveRepoDir(projectId, relativePath);
      const branches = await ctx.listBranches(projectId, relativePath);
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
      const baseBranch = await ctx.detectBaseBranch(repoDir);
      if (name === baseBranch) {
        throw new GitWorkflowError(
          409,
          "GIT_BASE_BRANCH_DELETE",
          `The base branch '${baseBranch}' cannot be deleted.`,
        );
      }
      await ctx.mapGit(() =>
        ctx.runGit(repoDir, ["branch", "--delete", "--", name]),
      );
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
