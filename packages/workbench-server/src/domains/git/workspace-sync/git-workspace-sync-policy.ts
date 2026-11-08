/** Pure scheduling and demand rules for GitWorkspaceSync; no I/O, timers or clocks. */

/** Native reads running at once across the whole daemon (tune for Windows). */
export const GIT_WORKSPACE_CONCURRENCY = 2;
/** Quiet time after the last change before a repository is read (absorbs editor/build bursts). */
export const GIT_WORKSPACE_DEBOUNCE_MS = 300;
/** A continuously changing repository is still read at least this often. */
export const GIT_WORKSPACE_MAX_WAIT_MS = 2_000;
/** Slow poll for scopes the native monitor cannot watch reliably. */
export const GIT_WORKSPACE_UNCERTAIN_POLL_MS = 30_000;

/** Lower value is served first. */
export const GitPriority = {
  /** Finished mutation: the user is waiting for its effect. */
  mutation: 0,
  /** Repository whose detail a client has open. */
  detail: 1,
  /** Last repository the user selected in the project. */
  selected: 2,
  /** Summaries of a visible project. */
  visible: 3,
  /** "May select soon" warming. */
  hint: 4,
} as const;
export type GitPriorityName = keyof typeof GitPriority;

export type GitWorkspaceDemand = {
  visible: boolean;
  detail?: readonly string[];
  hint?: string;
};

export const gitRepoKey = (projectId: string, repo: string) =>
  JSON.stringify([projectId, repo]);

/** Per-connection demand, released with the owner. Mirrors PrWatchRegistry. */
export class GitWorkspaceDemandRegistry {
  readonly owners = new Map<string, Map<string, GitWorkspaceDemand>>();

  sync(owner: string, projectId: string, demand: GitWorkspaceDemand) {
    let watches = this.owners.get(owner);
    if (!watches) this.owners.set(owner, (watches = new Map()));
    if (!demand.visible && !demand.detail?.length && !demand.hint) {
      this.clear(owner, projectId);
      return;
    }
    watches.set(projectId, demand);
  }

  clear(owner: string, projectId?: string) {
    if (projectId === undefined) {
      this.owners.delete(owner);
      return;
    }
    this.owners.get(owner)?.delete(projectId);
    if (!this.owners.get(owner)?.size) this.owners.delete(owner);
  }

  /** Projects the owner demanded before (for diffing after release). */
  projectsOf(owner: string): string[] {
    return [...(this.owners.get(owner)?.keys() ?? [])];
  }

  demands(projectId: string): GitWorkspaceDemand[] {
    return [...this.owners.values()].flatMap((watches) => {
      const demand = watches.get(projectId);
      return demand ? [demand] : [];
    });
  }

  hasOwner(owner: string, projectId: string): boolean {
    return this.owners.get(owner)?.has(projectId) ?? false;
  }

  /** Owners with demand on the project (event routing). */
  ownersOf(projectId: string): string[] {
    return [...this.owners].flatMap(([owner, watches]) =>
      watches.has(projectId) ? [owner] : [],
    );
  }
}

export type ProjectDemandSummary = {
  visible: boolean;
  details: Set<string>;
  hints: Set<string>;
};

export function summarizeDemands(
  demands: readonly GitWorkspaceDemand[],
): ProjectDemandSummary {
  const details = new Set<string>();
  const hints = new Set<string>();
  let visible = false;
  for (const demand of demands) {
    visible ||= demand.visible;
    for (const repo of demand.detail ?? []) details.add(repo);
    if (demand.hint) hints.add(demand.hint);
  }
  return { visible, details, hints };
}

/**
 * Class of a repository read, or null when nothing demands it.
 * A hint warms detail only; a visible project keeps every summary live.
 */
export function repoPriority(
  demand: ProjectDemandSummary,
  repo: string,
  selected: string | undefined,
  mutation: boolean,
  /** The pending read only warms a hinted repository's detail. */
  warmOnly = false,
): GitPriorityName | null {
  const demanded =
    demand.visible || demand.details.has(repo) || demand.hints.has(repo);
  if (!demanded) return null;
  if (mutation) return "mutation";
  if (demand.details.has(repo)) return "detail";
  if (warmOnly && demand.hints.has(repo)) return "hint";
  if (demand.visible && selected === repo) return "selected";
  if (demand.visible) return "visible";
  return "hint";
}

/** Whether a read of the repository must also produce its detail tier. */
export function wantsDetail(demand: ProjectDemandSummary, repo: string) {
  return demand.details.has(repo) || demand.hints.has(repo);
}

export type DirtyState = {
  /** First change since the last read started. */
  firstAt: number;
  /** Most recent change since the last read started. */
  lastAt: number;
  /** Manual refresh or finished mutation: skip the debounce. */
  immediate: boolean;
};

export function markDirty(
  previous: DirtyState | undefined,
  now: number,
  immediate: boolean,
): DirtyState {
  return {
    firstAt: previous?.firstAt ?? now,
    lastAt: now,
    immediate: immediate || (previous?.immediate ?? false),
  };
}

/** When the dirty repository may be read: trailing debounce capped by a max wait. */
export function dueAt(dirty: DirtyState): number {
  if (dirty.immediate) return dirty.firstAt;
  return Math.min(
    dirty.lastAt + GIT_WORKSPACE_DEBOUNCE_MS,
    dirty.firstAt + GIT_WORKSPACE_MAX_WAIT_MS,
  );
}

export type QueueCandidate = {
  key: string;
  priority: GitPriorityName;
  dirty: DirtyState;
  /** A read for this key is already running: the change waits for exactly one follow-up. */
  running: boolean;
};

/**
 * Candidates to start now (priority, then oldest due first) and the time the
 * next not-yet-due candidate becomes ready. Running keys never start twice, so
 * any number of changes during a read coalesce into one follow-up.
 */
export function planReads(
  candidates: readonly QueueCandidate[],
  now: number,
  runningCount: number,
  concurrency = GIT_WORKSPACE_CONCURRENCY,
): { start: string[]; wakeAt: number | null } {
  const idle = candidates.filter((candidate) => !candidate.running);
  const due = idle
    .filter((candidate) => dueAt(candidate.dirty) <= now)
    .sort(
      (a, b) =>
        GitPriority[a.priority] - GitPriority[b.priority] ||
        dueAt(a.dirty) - dueAt(b.dirty),
    );
  const start = due
    .slice(0, Math.max(0, concurrency - runningCount))
    .map((candidate) => candidate.key);
  const waiting = idle.filter((candidate) => dueAt(candidate.dirty) > now);
  const wakeAt = waiting.length
    ? Math.min(...waiting.map((candidate) => dueAt(candidate.dirty)))
    : null;
  return { start, wakeAt };
}

/** Uncertain scopes are polled slowly, only while demanded; never in a tight loop. */
export function nextUncertainPoll(
  lastReadAt: number | null,
  now: number,
): number {
  return Math.max(now, (lastReadAt ?? now) + GIT_WORKSPACE_UNCERTAIN_POLL_MS);
}

/** Project structure (repositories and worktrees) re-check cadence while visible. */
export const GIT_WORKSPACE_STRUCTURE_CHECK_MS = 60_000;

/** Stable text of the parts of a value that matter for change detection. */
export function fingerprint(value: unknown): string {
  return JSON.stringify(value);
}
