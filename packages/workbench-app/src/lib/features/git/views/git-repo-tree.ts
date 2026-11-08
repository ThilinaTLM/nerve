import type { GithubPr, GitRepoSummary } from "@nervekit/contracts/git";
import { repoButtonLabels } from "./git-change-format";

/** Stable key of the repository (shared Git directory) a summary belongs to. */
export const worktreeGroupOf = (repo: GitRepoSummary): string =>
  repo.worktreeGroup;
export const isPrimaryWorktree = (repo: GitRepoSummary): boolean =>
  repo.primaryWorktree;
export const stashCountOf = (repo: GitRepoSummary): number => repo.stashCount;

/** Last path segment; worktrees are identified by their folder. */
export function worktreeFolder(repo: GitRepoSummary): string {
  const segments = repo.absDir.split(/[\\/]/).filter(Boolean);
  return segments.at(-1) ?? repo.name;
}

// ---- Sync, pull request and attention rules ---------------------------------

/** Remote-operation facts about one worktree that the summary does not carry. */
export interface BranchStatusContext {
  readonly failed: (repo: GitRepoSummary) => boolean;
  readonly running: (repo: GitRepoSummary) => boolean;
  readonly pullRequest: (repo: GitRepoSummary) => GithubPr | undefined;
}

export type SyncKind =
  | "failed"
  | "running"
  | "behind"
  | "diverged"
  | "unpublished"
  | "ahead"
  | "none";

export interface SyncState {
  readonly kind: SyncKind;
  readonly behind: number;
  readonly ahead: number;
  readonly unpublished: number;
}

/** failed > running > behind > unpublished > ahead. */
const SYNC_RANK: Record<SyncKind, number> = {
  failed: 5,
  running: 4,
  behind: 3,
  diverged: 3,
  unpublished: 2,
  ahead: 1,
  none: 0,
};

export function isUnpublished(repo: GitRepoSummary): boolean {
  return Boolean(
    repo.hasRemote && !repo.detached && repo.currentBranch && !repo.hasUpstream,
  );
}

export function syncState(
  repo: GitRepoSummary,
  context: BranchStatusContext,
): SyncState {
  const behind = repo.behind ?? 0;
  const ahead = repo.ahead ?? 0;
  const unpublished = repo.unpublishedCount ?? 0;
  const make = (kind: SyncKind): SyncState => ({
    kind,
    behind,
    ahead,
    unpublished,
  });
  if (context.failed(repo)) return make("failed");
  if (context.running(repo)) return make("running");
  if (behind > 0) return make(ahead > 0 ? "diverged" : "behind");
  if (isUnpublished(repo)) return make("unpublished");
  if (ahead > 0) return make("ahead");
  return make("none");
}

export const syncRank = (state: SyncState): number => SYNC_RANK[state.kind];

export type ChecksStatus = GithubPr["checks"]["status"];
const CHECKS_RANK: Record<ChecksStatus, number> = {
  failing: 3,
  pending: 2,
  passing: 1,
  none: 0,
};

export const isOpenPr = (pr: GithubPr | undefined): pr is GithubPr =>
  Boolean(pr && pr.state.toUpperCase() === "OPEN");
export const isMergedPr = (pr: GithubPr | undefined): boolean =>
  pr?.state.toUpperCase() === "MERGED";

/**
 * The last remote operation failed; the branch's PR has failing checks; the
 * branch is merged into its base; or it is behind its upstream and also has
 * local commits or uncommitted changes. Only being behind does not count.
 */
export function needsAttention(
  repo: GitRepoSummary,
  context: BranchStatusContext,
): boolean {
  if (context.failed(repo)) return true;
  const pr = context.pullRequest(repo);
  if (isOpenPr(pr) && pr.checks.status === "failing") return true;
  if (isMergedPr(pr)) return true;
  if (repo.mergedToBase && !repo.onBaseBranch) return true;
  const behind = repo.behind ?? 0;
  const ahead = repo.ahead ?? 0;
  return behind > 0 && (ahead > 0 || repo.dirty || repo.changeCount > 0);
}

export interface CollapsedSummary {
  /** Most urgent sync state among the branches, `none` when all are calm. */
  readonly sync: SyncState;
  /** The branch whose state `sync` describes. */
  readonly syncRepo?: GitRepoSummary;
  /** Open PR with the worst checks state among the branches. */
  readonly pullRequest?: GithubPr;
  readonly changes: number;
}

export function collapsedSummary(
  repos: readonly GitRepoSummary[],
  context: BranchStatusContext,
): CollapsedSummary {
  let sync: SyncState = { kind: "none", behind: 0, ahead: 0, unpublished: 0 };
  let syncRepo: GitRepoSummary | undefined;
  let worst: GithubPr | undefined;
  let changes = 0;
  for (const repo of repos) {
    changes += repo.changeCount;
    const state = syncState(repo, context);
    if (syncRank(state) > syncRank(sync)) {
      sync = state;
      syncRepo = repo;
    }
    const pr = context.pullRequest(repo);
    if (
      isOpenPr(pr) &&
      (!worst ||
        CHECKS_RANK[pr.checks.status] > CHECKS_RANK[worst.checks.status])
    )
      worst = pr;
  }
  return {
    sync,
    ...(syncRepo ? { syncRepo } : {}),
    ...(worst ? { pullRequest: worst } : {}),
    changes,
  };
}

// ---- Branch names --------------------------------------------------------------

const KEEP_LEADING = 6;
const KEEP_TRAILING = 10;

/**
 * Splits a branch name for middle trimming: the head may shrink (CSS ellipsis,
 * keeping at least ~6 characters), the tail never does. Short names stay whole.
 */
export function splitBranchName(name: string): { head: string; tail: string } {
  const chars = Array.from(name);
  if (chars.length <= KEEP_LEADING + KEEP_TRAILING)
    return { head: name, tail: "" };
  return {
    head: chars.slice(0, -KEEP_TRAILING).join(""),
    tail: chars.slice(-KEEP_TRAILING).join(""),
  };
}

// ---- Groups --------------------------------------------------------------------

export interface GitRepoGroup {
  readonly key: string;
  /** Display name, disambiguated across the project. */
  readonly name: string;
  readonly primary: GitRepoSummary;
  /** Primary checkout first, then linked worktrees by folder name. */
  readonly repos: readonly GitRepoSummary[];
  /** Linked worktrees outside the project that are not listed. */
  readonly outside: number;
}

const byText = (a: string, b: string): number =>
  a.localeCompare(b, undefined, { sensitivity: "base" }) ||
  (a < b ? -1 : a > b ? 1 : 0);

/** Groups worktrees into repositories, ordered alphabetically by display name. */
export function buildRepoGroups(
  repositories: readonly GitRepoSummary[],
  /** Linked worktrees outside the project, per `worktreeGroup`. */
  outsideWorktrees: Readonly<Record<string, number>> = {},
): GitRepoGroup[] {
  const members = new Map<string, GitRepoSummary[]>();
  for (const repo of repositories) {
    const key = worktreeGroupOf(repo);
    const list = members.get(key);
    if (list) list.push(repo);
    else members.set(key, [repo]);
  }
  const drafts = [...members].map(([key, list]) => {
    const repos = [...list].sort(
      (a, b) =>
        Number(isPrimaryWorktree(b)) - Number(isPrimaryWorktree(a)) ||
        byText(worktreeFolder(a), worktreeFolder(b)),
    );
    return { key, repos, primary: repos[0]! };
  });
  const labels = repoButtonLabels(
    drafts.map((draft) => draft.primary),
    { maxLength: 40 },
  );
  return drafts
    .map(({ key, repos, primary }) => ({
      key,
      name: labels.get(primary.relativePath) ?? primary.name,
      primary,
      repos,
      outside: outsideWorktrees[key] ?? 0,
    }))
    .sort((a, b) => byText(a.name, b.name));
}

/** The selection a project starts with: the first branch of the first repository. */
export function defaultSelectedWorktree(
  repositories: readonly GitRepoSummary[],
): string | undefined {
  return buildRepoGroups(repositories)[0]?.repos[0]?.relativePath;
}

/** Branch checked out in another worktree of the same repository, by folder. */
export function checkedOutElsewhere(
  group: GitRepoGroup | undefined,
  repo: GitRepoSummary,
): ReadonlyMap<string, string> {
  const map = new Map<string, string>();
  for (const other of group?.repos ?? []) {
    if (other.relativePath === repo.relativePath || !other.currentBranch)
      continue;
    map.set(other.currentBranch, worktreeFolder(other));
  }
  return map;
}

// ---- Filtering -----------------------------------------------------------------

export type GitPanelFilter = "all" | "changed" | "attention";

export interface FilteredGroup {
  readonly group: GitRepoGroup;
  readonly repos: readonly GitRepoSummary[];
}

function matchesSearch(
  group: GitRepoGroup,
  repo: GitRepoSummary,
  terms: readonly string[],
): boolean {
  if (terms.length === 0) return true;
  const haystack = [
    group.name,
    repo.name,
    worktreeFolder(repo),
    repo.currentBranch ?? "detached",
  ]
    .join(" ")
    .toLowerCase();
  return terms.every((term) => haystack.includes(term));
}

export function filterRepoGroups(
  groups: readonly GitRepoGroup[],
  options: {
    readonly filter: GitPanelFilter;
    readonly search: string;
    readonly context: BranchStatusContext;
  },
): FilteredGroup[] {
  const terms = options.search.toLowerCase().split(/\s+/).filter(Boolean);
  const result: FilteredGroup[] = [];
  for (const group of groups) {
    const repos = group.repos.filter((repo) => {
      if (!matchesSearch(group, repo, terms)) return false;
      if (options.filter === "changed") return repo.changeCount > 0;
      if (options.filter === "attention")
        return needsAttention(repo, options.context);
      return true;
    });
    if (repos.length > 0) result.push({ group, repos });
  }
  return result;
}

export function filterCounts(
  repositories: readonly GitRepoSummary[],
  context: BranchStatusContext,
): Record<GitPanelFilter, number> {
  return {
    all: repositories.length,
    changed: repositories.filter((repo) => repo.changeCount > 0).length,
    attention: repositories.filter((repo) => needsAttention(repo, context))
      .length,
  };
}
