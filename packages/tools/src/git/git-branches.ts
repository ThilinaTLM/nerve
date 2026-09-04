import type {
  GitBranchListResponse,
  GitBranchSummary,
} from "@nervekit/contracts/git";
import type { GitReadSnapshot } from "./read/types.js";

export interface GitBranchServicePort {
  resolveRepoDir(projectId: string, relativePath: string): string;
  readSnapshot(repoDir: string): Promise<GitReadSnapshot>;
  comparisonBaseRef(repoDir: string, baseBranch: string): Promise<string>;
  mergedToBaseRef(
    repoDir: string,
    baseRef: string,
    state: {
      currentBranch: string | null;
      detached: boolean;
      onBaseBranch: boolean;
    },
  ): Promise<boolean>;
}

const BASE_BRANCH_CANDIDATES = ["main", "master", "develop"] as const;

export interface GitRefSnapshot {
  readonly refs: ReadonlySet<string>;
  readonly originHead?: string;
  readonly headBranch?: string;
}

export async function listBranches(
  service: GitBranchServicePort,
  projectId: string,
  relativePath: string,
): Promise<GitBranchListResponse> {
  const repoDir = service.resolveRepoDir(projectId, relativePath);
  const snapshot = await service.readSnapshot(repoDir);
  const branches = snapshot.refs
    .map((ref): GitBranchSummary | null => {
      const localPrefix = "refs/heads/";
      const remotePrefix = "refs/remotes/";
      const remote = ref.name.startsWith(remotePrefix);
      if (!remote && !ref.name.startsWith(localPrefix)) return null;
      const name = ref.name.slice(
        remote ? remotePrefix.length : localPrefix.length,
      );
      if (remote && name.endsWith("/HEAD")) return null;
      return {
        name,
        current: !remote && name === snapshot.branch.head,
        remote,
        upstream: ref.upstream ?? null,
        updatedAt:
          ref.commitTimestampSeconds === undefined
            ? null
            : new Date(ref.commitTimestampSeconds * 1_000).toISOString(),
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

export function refSnapshotFromRead(snapshot: GitReadSnapshot): GitRefSnapshot {
  const refs = new Set<string>();
  let originHead: string | undefined;
  for (const ref of snapshot.refs) {
    if (
      !ref.name.startsWith("refs/heads/") &&
      !ref.name.startsWith("refs/remotes/origin/")
    ) {
      continue;
    }
    refs.add(ref.name);
    if (ref.name === "refs/remotes/origin/HEAD" && ref.symbolicTarget) {
      originHead = ref.symbolicTarget;
    }
  }
  return { refs, originHead, headBranch: snapshot.branch.head ?? undefined };
}

export async function readRefSnapshot(
  service: GitBranchServicePort,
  repoDir: string,
): Promise<GitRefSnapshot> {
  try {
    return refSnapshotFromRead(await service.readSnapshot(repoDir));
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
  service: GitBranchServicePort,
  repoDir: string,
): Promise<string> {
  const snapshot = await readRefSnapshot(service, repoDir);
  const detected = baseBranchFromRefSnapshot(snapshot);
  if (detected) return detected;
  return snapshot.headBranch ?? "main";
}

export async function branchExists(
  service: GitBranchServicePort,
  repoDir: string,
  name: string,
): Promise<boolean> {
  const snapshot = await readRefSnapshot(service, repoDir);
  return (
    snapshot.refs.has(`refs/heads/${name}`) ||
    snapshot.refs.has(`refs/remotes/origin/${name}`)
  );
}

export async function comparisonBaseRef(
  service: GitBranchServicePort,
  repoDir: string,
  baseBranch: string,
): Promise<string> {
  const snapshot = await readRefSnapshot(service, repoDir);
  return comparisonBaseRefFromSnapshot(snapshot, baseBranch);
}

export async function mergedToBase(
  service: GitBranchServicePort,
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
  const baseRef = await service.comparisonBaseRef(repoDir, baseBranch);
  return service.mergedToBaseRef(repoDir, baseRef, state);
}
