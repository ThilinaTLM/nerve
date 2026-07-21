import type {
  GitOverviewResponse,
  GitRecentCommit,
  GitRepoSummary,
} from "@nervekit/contracts";
import type { GitService } from "./git-service.js";
import { parsePorcelainV2, parseShortstat } from "./git-status.js";

export async function summarizeRepo(
  service: GitService,
  repoDir: string,
  relativePath: string,
  name: string,
  statusOutput?: string,
): Promise<GitRepoSummary> {
  const [stdout, stable] = await Promise.all([
    statusOutput === undefined
      ? service
          .runGit(repoDir, ["status", "--porcelain=v2", "--branch"])
          .then((result) => result.stdout)
      : Promise.resolve(statusOutput),
    service.stableRepoMetadata(repoDir),
  ]);
  const { branch, files } = parsePorcelainV2(stdout);
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
  const statusPromise = service.runGit(repoDir, [
    "status",
    "--porcelain=v2",
    "--branch",
  ]);
  const repoPromise = statusPromise.then(({ stdout }) =>
    service.summarizeRepo(
      repoDir,
      relativePath,
      service.repoName(projectId, relativePath),
      stdout,
    ),
  );
  const [repo, { stdout: statusOut }, unstagedResult, stagedResult, recent] =
    await Promise.all([
      repoPromise,
      statusPromise,
      service.runGit(repoDir, ["diff", "--shortstat"]),
      service.runGit(repoDir, ["diff", "--staged", "--shortstat"]),
      service.recentCommits(repoDir),
    ]);
  const { files } = parsePorcelainV2(statusOut);
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
    recentCommits: recent,
  };
}

export async function recentCommits(
  service: GitService,
  repoDir: string,
): Promise<GitRecentCommit[]> {
  try {
    const { stdout } = await service.runGit(repoDir, [
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
