import type {
  GitMutationResponse,
  GitStashArea,
} from "@nervekit/contracts/git";
import type { GitMutationContext } from "./git-mutation-context.js";
import { inGitLane } from "./git-operation-context.js";
import {
  createAreaStash,
  stashApplyArgs,
  verifyStashTarget,
} from "./git-stash.js";

export async function createStash(
  ctx: GitMutationContext,
  projectId: string,
  relativePath: string,
  area: GitStashArea,
  paths?: readonly string[],
): Promise<GitMutationResponse> {
  return inGitLane(
    ctx.resolveRepoDir(projectId, relativePath),
    false,
    async () => {
      const repoDir = ctx.resolveRepoDir(projectId, relativePath);
      await ctx.mapGit(() => createAreaStash(ctx, repoDir, area, paths));
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

export async function applyStash(
  ctx: GitMutationContext,
  projectId: string,
  relativePath: string,
  index: number,
  expectedHash: string,
): Promise<GitMutationResponse> {
  return inGitLane(
    ctx.resolveRepoDir(projectId, relativePath),
    false,
    async () => {
      const repoDir = ctx.resolveRepoDir(projectId, relativePath);
      const ref = await verifyStashTarget(ctx, repoDir, index, expectedHash);
      await ctx.mapGit(async () =>
        ctx.runGit(repoDir, await stashApplyArgs(ctx, repoDir, ref)),
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

export async function dropStash(
  ctx: GitMutationContext,
  projectId: string,
  relativePath: string,
  index: number,
  expectedHash: string,
): Promise<GitMutationResponse> {
  return inGitLane(
    ctx.resolveRepoDir(projectId, relativePath),
    false,
    async () => {
      const repoDir = ctx.resolveRepoDir(projectId, relativePath);
      const ref = await verifyStashTarget(ctx, repoDir, index, expectedHash);
      await ctx.mapGit(() => ctx.runGit(repoDir, ["stash", "drop", ref]));
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
