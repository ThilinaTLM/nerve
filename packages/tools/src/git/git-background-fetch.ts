import type { GitCommandOptions } from "./git-command.js";
import type { ExecResult } from "./git-command.js";
import { hasGitNetworkWork, inGitLane } from "./git-operation-context.js";

/** Never prompt: a background fetch has nobody to answer. */
export const BACKGROUND_FETCH_ENV: Record<string, string> = {
  GIT_TERMINAL_PROMPT: "0",
  GCM_INTERACTIVE: "never",
  SSH_ASKPASS_REQUIRE: "never",
  // Git consults the askpass helper before the terminal; an empty answer fails authentication.
  ...(process.platform === "win32" ? {} : { GIT_ASKPASS: "true" }),
};

export interface BackgroundFetchContext {
  resolveRepoDir(projectId: string, relativePath: string): string;
  run(
    cwd: string,
    args: string[],
    options: GitCommandOptions,
  ): Promise<ExecResult>;
  invalidateStableRepoMetadata(repoDir: string): void;
}

export type BackgroundFetchResult =
  | { status: "busy" }
  | { status: "done"; moved: boolean };

/**
 * Non-interactive `git fetch --prune` that yields to user remote operations:
 * it neither starts while one runs or waits in the repository's lane nor
 * prompts for credentials. `moved` reports whether any remote-tracking ref changed.
 */
export async function backgroundFetch(
  ctx: BackgroundFetchContext,
  projectId: string,
  relativePath: string,
  signal?: AbortSignal,
): Promise<BackgroundFetchResult> {
  const repoDir = ctx.resolveRepoDir(projectId, relativePath);
  if (await hasGitNetworkWork(repoDir)) return { status: "busy" };
  const options: GitCommandOptions = {
    network: true,
    signal,
    env: BACKGROUND_FETCH_ENV,
  };
  return inGitLane(
    repoDir,
    true,
    async () => {
      const refs = async () =>
        (
          await ctx.run(
            repoDir,
            [
              "for-each-ref",
              "--format=%(objectname) %(refname)",
              "refs/remotes",
            ],
            { signal },
          )
        ).stdout;
      const before = await refs();
      await ctx.run(
        repoDir,
        ["fetch", "--prune", "--no-tags", "--quiet"],
        options,
      );
      const moved = (await refs()) !== before;
      if (moved) ctx.invalidateStableRepoMetadata(repoDir);
      return { status: "done" as const, moved };
    },
    options,
  );
}
