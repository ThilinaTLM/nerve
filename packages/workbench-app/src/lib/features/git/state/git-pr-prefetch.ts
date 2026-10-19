type Timer = ReturnType<typeof setTimeout>;
export type PrPrefetchClock = {
  setTimeout(callback: () => void, delay: number): Timer;
  clearTimeout(timer: Timer): void;
};

// Browser timers must not receive the clock object as their native receiver.
const systemClock: PrPrefetchClock = {
  setTimeout: (callback, delay) => setTimeout(callback, delay),
  clearTimeout: (timer) => clearTimeout(timer),
};

/** Selected reads have their own immediate lane; enrichment is serial and deferred. */
export class GitPrPrefetchScheduler {
  #project?: string;
  #generation = 0;
  #pending: string[] = [];
  #timer?: Timer;
  #background = false;
  #selected = new Set<string>();

  constructor(
    readonly deps: {
      isFresh(project: string, repo: string): boolean;
      load(
        project: string,
        repo: string,
        isCurrent: () => boolean,
      ): Promise<void>;
      clock?: PrPrefetchClock;
      delayMs?: number;
    },
  ) {}

  get clock(): PrPrefetchClock {
    return this.deps.clock ?? systemClock;
  }

  schedule(project: string, selected: string, repos: readonly string[]): void {
    if (project !== this.#project) {
      this.cancel();
      this.#project = project;
    }
    const generation = this.#generation;
    const current = () =>
      this.#generation === generation && this.#project === project;
    const key = JSON.stringify([project, selected, generation]);
    if (!this.deps.isFresh(project, selected) && !this.#selected.has(key)) {
      this.#selected.add(key);
      void this.deps
        .load(project, selected, current)
        .catch(() => undefined)
        .finally(() => {
          this.#selected.delete(key);
        });
    }
    this.#pending = [...new Set(repos)].filter(
      (repo) => repo !== selected && !this.deps.isFresh(project, repo),
    );
    this.#defer();
  }

  cancel(): void {
    this.#generation++;
    this.#project = undefined;
    this.#pending = [];
    if (this.#timer !== undefined) this.clock.clearTimeout(this.#timer);
    this.#timer = undefined;
  }

  #defer(): void {
    if (this.#timer !== undefined || this.#background || !this.#pending.length)
      return;
    this.#timer = this.clock.setTimeout(() => {
      this.#timer = undefined;
      this.#next();
    }, this.deps.delayMs ?? 200);
  }

  #next(): void {
    const project = this.#project;
    if (!project) return;
    const repo = this.#pending.shift();
    if (repo === undefined) return;
    if (this.deps.isFresh(project, repo)) {
      this.#defer();
      return;
    }
    const generation = this.#generation;
    this.#background = true;
    void this.deps
      .load(
        project,
        repo,
        () => this.#generation === generation && this.#project === project,
      )
      .catch(() => undefined)
      .finally(() => {
        this.#background = false;
        this.#defer();
      });
  }
}
