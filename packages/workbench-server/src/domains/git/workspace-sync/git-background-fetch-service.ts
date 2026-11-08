import {
  afterBusy,
  afterFailure,
  afterSuccess,
  BACKGROUND_FETCH_GAP_MS,
  groupRepresentatives,
  nextFetch,
  reconcileGroups,
  type FetchCandidate,
  type FetchGroupState,
} from "./git-background-fetch-policy.js";

const REPLAN_MS = 30_000;

export type BackgroundFetchBackend = {
  backgroundFetch(
    projectId: string,
    repo: string,
    signal?: AbortSignal,
  ): Promise<{ status: "busy" } | { status: "done"; moved: boolean }>;
};

/**
 * Staggered, daemon-wide-serial `git fetch` for repositories with a remote in a
 * visible project, once per repository group. Remote refs that moved are
 * reported for every worktree of the group.
 */
export class GitBackgroundFetch {
  readonly #states = new Map<string, FetchGroupState>();
  readonly #controller = new AbortController();
  #timer?: ReturnType<typeof setTimeout>;
  #running?: Promise<void>;
  #notBefore = 0;
  #closed = false;
  #started = false;

  constructor(
    readonly backend: BackgroundFetchBackend,
    readonly source: { candidates(): FetchCandidate[] },
    readonly onMoved: (members: FetchCandidate[]) => void,
    readonly options: { now?: () => number; random?: () => number } = {},
  ) {}

  #now() {
    return (this.options.now ?? Date.now)();
  }
  #random() {
    return (this.options.random ?? Math.random)();
  }

  start() {
    this.#started = true;
    this.#plan();
  }

  /** Re-plan after the set of visible repositories may have changed. */
  poke() {
    if (this.#started) this.#plan();
  }

  #plan() {
    if (this.#closed || this.#running) return;
    clearTimeout(this.#timer);
    this.#timer = undefined;
    const now = this.#now();
    const candidates = this.source.candidates();
    const groups = groupRepresentatives(candidates);
    reconcileGroups(this.#states, new Set(groups.keys()), now, () =>
      this.#random(),
    );
    const next = nextFetch({
      states: this.#states,
      now,
      notBefore: this.#notBefore,
    });
    if (!next || "wakeAt" in next) {
      // Re-plan at the next due time, and at least periodically: visibility changes are not pushed.
      const wait = next ? Math.min(next.wakeAt - now, REPLAN_MS) : REPLAN_MS;
      this.#timer = setTimeout(() => this.#plan(), Math.max(0, wait));
      this.#timer.unref();
      return;
    }
    const representative = groups.get(next.group);
    if (!representative) return;
    this.#running = this.#fetch(next.group, representative, candidates).finally(
      () => {
        this.#running = undefined;
        this.#notBefore = this.#now() + BACKGROUND_FETCH_GAP_MS;
        this.#plan();
      },
    );
  }

  async #fetch(
    group: string,
    representative: FetchCandidate,
    candidates: FetchCandidate[],
  ) {
    const previous = this.#states.get(group) ?? { nextAt: 0, failures: 0 };
    try {
      const result = await this.backend.backgroundFetch(
        representative.projectId,
        representative.repo,
        this.#controller.signal,
      );
      if (this.#closed) return;
      if (result.status === "busy") {
        this.#states.set(group, afterBusy(previous, this.#now()));
        return;
      }
      this.#states.set(group, afterSuccess(this.#now(), this.#random()));
      if (result.moved) {
        try {
          this.onMoved(candidates.filter((c) => c.group === group));
        } catch {
          /* Observers cannot fail the schedule. */
        }
      }
    } catch {
      if (this.#closed) return;
      this.#states.set(
        group,
        afterFailure(previous, this.#now(), this.#random()),
      );
    }
  }

  /** Test helper: resolves when no fetch is running. */
  async idle() {
    await this.#running;
  }

  async close() {
    this.#closed = true;
    clearTimeout(this.#timer);
    this.#controller.abort();
    await this.#running?.catch(() => {});
    this.#states.clear();
  }
}
