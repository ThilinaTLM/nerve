import type { GitMutationResponse } from "@nervekit/contracts/git";
import type { GitMutationContext } from "./git-mutation-context.js";
import { inGitLane } from "./git-operation-context.js";
import { parsePorcelainV2 } from "./git-status.js";

export async function stageFile(
  ctx: GitMutationContext,
  projectId: string,
  relativePath: string,
  path: string,
): Promise<GitMutationResponse> {
  return inGitLane(
    ctx.resolveRepoDir(projectId, relativePath),
    false,
    async () => {
      const repoDir = ctx.resolveRepoDir(projectId, relativePath);
      await ctx.mapGit(() => ctx.runGit(repoDir, ["add", "--", path]));
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

export async function unstageFile(
  ctx: GitMutationContext,
  projectId: string,
  relativePath: string,
  path: string,
): Promise<GitMutationResponse> {
  return inGitLane(
    ctx.resolveRepoDir(projectId, relativePath),
    false,
    async () => {
      const repoDir = ctx.resolveRepoDir(projectId, relativePath);
      await ctx.mapGit(() =>
        ctx.runGit(repoDir, ["restore", "--staged", "--", path]),
      );
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

export async function discardFile(
  ctx: GitMutationContext,
  projectId: string,
  relativePath: string,
  path: string,
): Promise<GitMutationResponse> {
  return inGitLane(
    ctx.resolveRepoDir(projectId, relativePath),
    false,
    async () => {
      const repoDir = ctx.resolveRepoDir(projectId, relativePath);
      const before = parsePorcelainV2(
        (await ctx.runGit(repoDir, ["status", "--porcelain=v2"])).stdout,
      ).files.find((file) => file.path === path || file.renamedFrom === path);

      try {
        await ctx.runGit(repoDir, ["restore", "--staged", "--", path]);
      } catch {
        // The path may not be staged; continue with worktree cleanup.
      }
      if (!before?.untracked) {
        try {
          await ctx.runGit(repoDir, ["restore", "--worktree", "--", path]);
        } catch {
          // Newly-added or deleted paths may require git clean instead.
        }
      }
      await ctx.mapGit(() => ctx.runGit(repoDir, ["clean", "-f", "--", path]));
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
