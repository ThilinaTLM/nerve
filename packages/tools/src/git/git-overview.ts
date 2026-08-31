import type {
  GitOverviewResponse,
  GitRecentCommit,
  GitRepoSummary,
} from "@nervekit/contracts/git";
import type { GitService } from "./git-service.js";
import type { GitReadSnapshot } from "./read/types.js";
import { parsePorcelainV2, parseShortstat } from "./git-status.js";

export async function summarizeRepo(
  service: GitService,
  repoDir: string,
  relativePath: string,
  name: string,
  statusOutput?: string,
  readSnapshot?: GitReadSnapshot,
): Promise<GitRepoSummary> {
  const [read, stable] = await Promise.all([
    readSnapshot
      ? Promise.resolve(readSnapshot)
      : statusOutput === undefined
        ? service.readSnapshot(repoDir)
        : Promise.resolve(null),
    service.stableRepoMetadata(repoDir),
  ]);
  const { branch, files } = read ?? parsePorcelainV2(statusOutput ?? "");
  const onBaseBranch = branch.head === stable.baseBranch;
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
    hasRemote: stable.remoteState.hasRemote,
    hasGithubRemote: stable.remoteState.hasGithubRemote,
    baseBranch: stable.baseBranch,
    onBaseBranch,
    mergedToBase: await service.mergedToBaseRef(
      repoDir,
      stable.comparisonBaseRef,
      {
        currentBranch: branch.head,
        detached: branch.detached,
        onBaseBranch,
      },
    ),
    dirty: files.length > 0,
    changeCount: files.length,
  };
}

export async function overview(
  service: GitService,
  projectId: string,
  relativePath: string,
): Promise<GitOverviewResponse> {
  const repoDir = service.resolveRepoDir(projectId, relativePath);
  const snapshotPromise = service.readSnapshot(repoDir);
  const repoPromise = snapshotPromise.then((snapshot) =>
    summarizeRepo(
      service,
      repoDir,
      relativePath,
      service.repoName(projectId, relativePath),
      undefined,
      snapshot,
    ),
  );
  const [repo, snapshot, unstagedResult, stagedResult] = await Promise.all([
    repoPromise,
    snapshotPromise,
    service.runGit(repoDir, ["diff", "--shortstat"]),
    service.runGit(repoDir, ["diff", "--staged", "--shortstat"]),
  ]);
  const { files } = snapshot;
  const stagedCount = files.filter((file) => file.staged).length;
  const untrackedCount = files.filter((file) => file.untracked).length;
  const unstagedCount = files.filter(
    (file) => !file.untracked && file.worktree !== " ",
  ).length;
  const unstaged = parseShortstat(unstagedResult.stdout);
  const staged = parseShortstat(stagedResult.stdout);

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
    recentCommits: snapshot.recentCommits,
    stashes: snapshot.stashes,
  };
}

export async function recentCommits(
  service: GitService,
  repoDir: string,
): Promise<GitRecentCommit[]> {
  try {
    return (await service.readSnapshot(repoDir)).recentCommits;
  } catch {
    return [];
  }
}
