import type {
  GitBranchListResponse,
  GitBranchSummary,
} from "@nervekit/contracts";
import type { GitService } from "./git-service.js";

const BASE_BRANCH_CANDIDATES = ["main", "master", "develop"] as const;

export interface GitRefSnapshot {
  readonly refs: ReadonlySet<string>;
  readonly originHead?: string;
}

export async function listBranches(
  this: GitService,
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
      if (refname.startsWith("refs/remotes/") && shortName.endsWith("/HEAD")) {
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

export async function readRefSnapshot(
  this: GitService,
  repoDir: string,
): Promise<GitRefSnapshot> {
  try {
    const { stdout } = await this.runGit(repoDir, [
      "for-each-ref",
      "--format=%(refname)%00%(symref)",
      "refs/heads",
      "refs/remotes/origin",
    ]);
    const refs = new Set<string>();
    let originHead: string | undefined;
    for (const line of stdout.split("\n")) {
      if (!line) continue;
      const [refname, symref] = line.split("\u0000");
      if (!refname) continue;
      refs.add(refname);
      if (refname === "refs/remotes/origin/HEAD" && symref) {
        originHead = symref;
      }
    }
    return { refs, originHead };
  } catch {
    return { refs: new Set() };
  }
}

export function baseBranchFromRefSnapshot(
  snapshot: GitRefSnapshot,
): string | undefined {
  const prefix = "refs/remotes/origin/";
  if (snapshot.originHead?.startsWith(prefix)) {
    return snapshot.originHead.slice(prefix.length);
  }
  for (const candidate of BASE_BRANCH_CANDIDATES) {
    if (
      snapshot.refs.has(`refs/heads/${candidate}`) ||
      snapshot.refs.has(`refs/remotes/origin/${candidate}`)
    ) {
      return candidate;
    }
  }
  return undefined;
}

export function comparisonBaseRefFromSnapshot(
  snapshot: GitRefSnapshot,
  baseBranch: string,
): string {
  const remote = `refs/remotes/origin/${baseBranch}`;
  if (snapshot.refs.has(remote) || snapshot.originHead === remote)
    return remote;
  const local = `refs/heads/${baseBranch}`;
  if (snapshot.refs.has(local)) return local;
  return baseBranch;
}

export async function detectBaseBranch(
  this: GitService,
  repoDir: string,
): Promise<string> {
  const snapshot = await readRefSnapshot.call(this, repoDir);
  const detected = baseBranchFromRefSnapshot(snapshot);
  if (detected) return detected;
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

export async function branchExists(
  this: GitService,
  repoDir: string,
  name: string,
): Promise<boolean> {
  const snapshot = await readRefSnapshot.call(this, repoDir);
  return (
    snapshot.refs.has(`refs/heads/${name}`) ||
    snapshot.refs.has(`refs/remotes/origin/${name}`)
  );
}

export async function comparisonBaseRef(
  this: GitService,
  repoDir: string,
  baseBranch: string,
): Promise<string> {
  const snapshot = await readRefSnapshot.call(this, repoDir);
  return comparisonBaseRefFromSnapshot(snapshot, baseBranch);
}

export async function mergedToBase(
  this: GitService,
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
