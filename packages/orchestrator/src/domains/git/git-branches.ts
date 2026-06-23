import type { GitBranchListResponse, GitBranchSummary } from "@nerve/shared";
import type { GitService } from "./git-service.js";

export async function listBranches(this: GitService,
  projectId: string,
  relativePath: string,
): Promise<GitBranchListResponse> {
  const repoDir = this.resolveRepoDir(projectId, relativePath);
  const { stdout } = await this.runGit(repoDir, [
    "for-each-ref",
    "--format=%(refname)%00%(refname:short)%00%(upstream:short)%00%(HEAD)",
    "refs/heads",
    "refs/remotes",
  ]);
  const branches = stdout
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line): GitBranchSummary | null => {
      const [refname, shortName, upstream, head] = line.split("\u0000");
      if (!refname || !shortName) return null;
      if (
        refname.startsWith("refs/remotes/") &&
        shortName.endsWith("/HEAD")
      ) {
        return null;
      }
      return {
        name: shortName,
        current: head === "*",
        remote: refname.startsWith("refs/remotes/"),
        upstream: upstream && upstream.length > 0 ? upstream : null,
      };
    })
    .filter((branch): branch is GitBranchSummary => branch !== null)
    .sort((a, b) => {
      if (a.current !== b.current) return a.current ? -1 : 1;
      if (a.remote !== b.remote) return a.remote ? 1 : -1;
      return a.name.localeCompare(b.name);
    });
  return { branches };
}


export async function detectBaseBranch(this: GitService, repoDir: string): Promise<string> {
  try {
    const { stdout } = await this.runGit(repoDir, [
      "symbolic-ref",
      "--quiet",
      "refs/remotes/origin/HEAD",
    ]);
    const ref = stdout.trim();
    if (ref.startsWith("refs/remotes/origin/")) {
      return ref.slice("refs/remotes/origin/".length);
    }
  } catch {
    // fall through to probing
  }
  for (const candidate of ["main", "master", "develop"]) {
    if (await this.branchExists(repoDir, candidate)) return candidate;
  }
  try {
    const { stdout } = await this.runGit(repoDir, [
      "rev-parse",
      "--abbrev-ref",
      "HEAD",
    ]);
    return stdout.trim() || "main";
  } catch {
    return "main";
  }
}


export async function branchExists(this: GitService, repoDir: string, name: string): Promise<boolean> {
  try {
    await this.runGit(repoDir, [
      "rev-parse",
      "--verify",
      "--quiet",
      `refs/heads/${name}`,
    ]);
    return true;
  } catch {
    try {
      await this.runGit(repoDir, [
        "rev-parse",
        "--verify",
        "--quiet",
        `refs/remotes/origin/${name}`,
      ]);
      return true;
    } catch {
      return false;
    }
  }
}


export async function comparisonBaseRef(this: GitService,
  repoDir: string,
  baseBranch: string,
): Promise<string> {
  for (const candidate of [
    `refs/remotes/origin/${baseBranch}`,
    `refs/heads/${baseBranch}`,
    baseBranch,
  ]) {
    try {
      await this.runGit(repoDir, [
        "rev-parse",
        "--verify",
        "--quiet",
        `${candidate}^{commit}`,
      ]);
      return candidate;
    } catch {
      // Try the next possible ref.
    }
  }
  return baseBranch;
}


export async function mergedToBase(this: GitService,
  repoDir: string,
  baseBranch: string,
  state: {
    currentBranch: string | null;
    detached: boolean;
    onBaseBranch: boolean;
  },
): Promise<boolean> {
  if (state.detached || state.onBaseBranch || !state.currentBranch) {
    return false;
  }
  const baseRef = await this.comparisonBaseRef(repoDir, baseBranch);
  try {
    await this.runGit(repoDir, [
      "merge-base",
      "--is-ancestor",
      "HEAD",
      baseRef,
    ]);
    return true;
  } catch {
    return false;
  }
}

