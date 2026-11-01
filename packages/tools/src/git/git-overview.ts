import type {
  GitOverviewResponse,
  GitRecentCommit,
  GitRepoSummary,
} from "@nervekit/contracts/git";
import type { GitService } from "./git-service.js";
import type { GitReadSnapshot } from "./read/types.js";
import { parsePorcelainV2, parseShortstat } from "./git-status.js";
import { stableMetadataFromRead } from "./git-repository-metadata.js";

export async function summarizeRepo(
  service: GitService,
  repoDir: string,
  relativePath: string,
  name: string,
  statusOutput?: string,
  readSnapshot?: Pick<GitReadSnapshot, "branch" | "files"> &
    Partial<Pick<GitReadSnapshot, "refs" | "remotes">>,
): Promise<GitRepoSummary> {
  const read =
    readSnapshot ??
    (statusOutput === undefined ? await service.readSnapshot(repoDir) : null);
  const stable =
    read?.refs && read.remotes
      ? stableMetadataFromRead({
          branch: read.branch,
          refs: read.refs,
          remotes: read.remotes,
        })
      : await service.stableRepoMetadata(repoDir);
  const { branch, files } = read ?? parsePorcelainV2(statusOutput ?? "");
  const onBaseBranch = branch.head === stable.baseBranch;
  const hasRemote = stable.remoteState.hasRemote;
  const unpublishedCount =
    hasRemote && !branch.detached && branch.head && branch.upstream === null
      ? await service.unpublishedCommitCount(repoDir)
      : null;
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
    unpublishedCount,
    hasStashes: stable.hasStash,
    hasRemote,
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
  // The overview owns one repository lane. Sequence its conservative reads so
  // failure/cancellation cannot release that lane before another read closes.
  const snapshot = await service.readSnapshot(repoDir);
  const repo = await summarizeRepo(
    service,
    repoDir,
    relativePath,
    service.repoName(projectId, relativePath),
    undefined,
    snapshot,
  );
  const unstagedResult = await service.runGit(repoDir, ["diff", "--shortstat"]);
  const stagedResult = await service.runGit(repoDir, [
    "diff",
    "--staged",
    "--shortstat",
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
    return (
      await service.readMetadataSnapshot(repoDir, { recentCommitLimit: 10 })
    ).recentCommits;
  } catch (error) {
    if (
      error instanceof Error &&
      (error.name === "AbortError" ||
        ("category" in error && error.category === "cancelled"))
    )
      throw error;
    return [];
  }
}
