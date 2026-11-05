import type {
  GitBranchListResponse,
  GitRepoSummary,
} from "@nervekit/contracts/git";
import type { ExecResult } from "./git-command.js";
import type { StableRepoMetadata } from "./git-repository-metadata.js";

/**
 * Narrow view of `GitService` that repository-mutating workflows depend on.
 * `GitService` builds one over its private collaborators and passes it to the
 * capability modules (branches, working tree, stash, remote operations).
 */
export interface GitMutationContext {
  resolveRepoDir(projectId: string, relativePath: string): string;
  runGit(cwd: string, args: string[]): Promise<ExecResult>;
  mapGit<T>(fn: () => Promise<T>): Promise<T>;
  summarizeRepo(
    repoDir: string,
    relativePath: string,
    name: string,
  ): Promise<GitRepoSummary>;
  repoName(projectId: string, relativePath: string): string;
  invalidateStableRepoMetadata(repoDir?: string): void;
  stableRepoMetadata(repoDir: string): Promise<StableRepoMetadata>;
  listBranches(
    projectId: string,
    relativePath: string,
  ): Promise<GitBranchListResponse>;
  detectBaseBranch(repoDir: string): Promise<string>;
  validateBranchName(name: string): Promise<boolean>;
}
