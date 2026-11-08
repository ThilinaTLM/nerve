/** Pure scheduling rules for the background `git fetch`; no I/O, timers or clocks. */

/** A repository group is fetched every 5-10 minutes. */
export const BACKGROUND_FETCH_MIN_MS = 5 * 60_000;
export const BACKGROUND_FETCH_MAX_MS = 10 * 60_000;
/** Failures back off exponentially from the interval, up to this ceiling. */
export const BACKGROUND_FETCH_BACKOFF_CAP_MS = 60 * 60_000;
/** Pause between two fetches daemon-wide (they also run strictly one at a time). */
export const BACKGROUND_FETCH_GAP_MS = 5_000;
/** A repository busy with a user remote operation is looked at again after this. */
export const BACKGROUND_FETCH_BUSY_RETRY_MS = 30_000;

/** One worktree or clone that could run the fetch for its group. */
export type FetchCandidate = {
  projectId: string;
  repo: string;
  /** `worktreeGroup`: identical for all worktrees of one repository. */
  group: string;
  primary: boolean;
};

export type FetchGroupState = { nextAt: number; failures: number };

/** Uniform delay in [MIN, MAX); `random` is in [0, 1). */
export function fetchInterval(random: number): number {
  return (
    BACKGROUND_FETCH_MIN_MS +
    clamp01(random) * (BACKGROUND_FETCH_MAX_MS - BACKGROUND_FETCH_MIN_MS)
  );
}

/** First fetch of a newly visible group: spread over one minimum interval so opening many projects never fetches in a burst. */
export function initialFetchDelay(random: number): number {
  return clamp01(random) * BACKGROUND_FETCH_MIN_MS;
}

/** Delay after `failures` consecutive failures (>= 1): the jittered interval doubled per failure, capped. */
export function fetchBackoff(failures: number, random: number): number {
  const factor = 2 ** Math.min(Math.max(failures, 1), 10);
  return Math.min(
    fetchInterval(random) * factor,
    BACKGROUND_FETCH_BACKOFF_CAP_MS,
  );
}

/** One representative per repository group (primary worktree preferred, then stable order). */
export function groupRepresentatives(
  candidates: readonly FetchCandidate[],
): Map<string, FetchCandidate> {
  const groups = new Map<string, FetchCandidate>();
  for (const candidate of candidates) {
    const current = groups.get(candidate.group);
    if (!current || better(candidate, current))
      groups.set(candidate.group, candidate);
  }
  return groups;
}

function better(a: FetchCandidate, b: FetchCandidate): boolean {
  if (a.primary !== b.primary) return a.primary;
  return (
    a.projectId < b.projectId ||
    (a.projectId === b.projectId && a.repo < b.repo)
  );
}

/**
 * Reconcile group state with the current candidates: new groups are scheduled
 * with a staggered start, vanished groups are dropped.
 */
export function reconcileGroups(
  states: Map<string, FetchGroupState>,
  groups: ReadonlySet<string>,
  now: number,
  random: () => number,
) {
  for (const group of [...states.keys()])
    if (!groups.has(group)) states.delete(group);
  for (const group of groups)
    if (!states.has(group))
      states.set(group, {
        nextAt: now + initialFetchDelay(random()),
        failures: 0,
      });
}

/**
 * The due group to fetch now (earliest first), skipping groups with a user
 * remote operation in flight, or the time to look again.
 */
export function nextFetch(input: {
  states: ReadonlyMap<string, FetchGroupState>;
  now: number;
  /** Earliest time a fetch may start (daemon-wide gap after the previous one). */
  notBefore: number;
}): { group: string } | { wakeAt: number } | null {
  let earliest: number | null = null;
  let due: { group: string; nextAt: number } | undefined;
  for (const [group, state] of input.states) {
    const at = Math.max(state.nextAt, input.notBefore);
    if (at <= input.now) {
      if (!due || state.nextAt < due.nextAt)
        due = { group, nextAt: state.nextAt };
    } else earliest = Math.min(earliest ?? at, at);
  }
  if (due) return { group: due.group };
  return earliest === null ? null : { wakeAt: earliest };
}

export function afterSuccess(now: number, random: number): FetchGroupState {
  return { nextAt: now + fetchInterval(random), failures: 0 };
}

export function afterFailure(
  previous: FetchGroupState,
  now: number,
  random: number,
): FetchGroupState {
  const failures = previous.failures + 1;
  return { nextAt: now + fetchBackoff(failures, random), failures };
}

export function afterBusy(
  previous: FetchGroupState,
  now: number,
): FetchGroupState {
  return {
    nextAt: now + BACKGROUND_FETCH_BUSY_RETRY_MS,
    failures: previous.failures,
  };
}

function clamp01(value: number) {
  return Number.isFinite(value) ? Math.min(Math.max(value, 0), 0.999999) : 0;
}
