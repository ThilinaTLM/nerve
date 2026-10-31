export type GitAutoRefreshDemand = {
  overview?: boolean;
  /** Unproven poll notice: do not supersede kept server work. */
  uncertain?: boolean;
};

export type GitAutoRefreshTarget = "overview";

type Clock = {
  now(): number;
  setTimeout(
    callback: () => void,
    delayMs: number,
  ): ReturnType<typeof setTimeout>;
  clearTimeout(timer: ReturnType<typeof setTimeout>): void;
};

type Entry = {
  key: string;
  pending: { overview: boolean; uncertain?: boolean };
  lastStartedAt: Record<GitAutoRefreshTarget, number | undefined>;
  timer?: ReturnType<typeof setTimeout>;
};

const systemClock: Clock = {
  now: () => Date.now(),
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimeout: (timer) => clearTimeout(timer),
};

export class GitAutoRefreshScheduler {
  readonly #entries = new Map<string, Entry>();

  constructor(
    readonly cooldownMs: Record<GitAutoRefreshTarget, number>,
    readonly dispatch: (key: string, demand: GitAutoRefreshDemand) => void,
    readonly clock: Clock = systemClock,
  ) {}

  schedule(key: string, demand: GitAutoRefreshDemand): void {
    const entry = this.#entry(key);
    if (demand.overview)
      entry.pending.uncertain = entry.pending.overview
        ? Boolean(entry.pending.uncertain && demand.uncertain)
        : Boolean(demand.uncertain);
    entry.pending.overview ||= Boolean(demand.overview);
    this.#dispatchDue(entry);
  }

  noteDirectStart(key: string, demand: GitAutoRefreshDemand): void {
    const entry = this.#entry(key);
    const now = this.clock.now();
    for (const target of targets(demand)) {
      entry.lastStartedAt[target] = now;
      entry.pending[target] = false;
    }
    this.#scheduleTimer(entry);
  }

  #entry(key: string): Entry {
    const existing = this.#entries.get(key);
    if (existing) return existing;
    const entry: Entry = {
      key,
      pending: { overview: false },
      lastStartedAt: { overview: undefined },
    };
    this.#entries.set(key, entry);
    return entry;
  }

  #dispatchDue(entry: Entry): void {
    const now = this.clock.now();
    const due: GitAutoRefreshDemand = {};
    for (const target of targets(entry.pending)) {
      const lastStartedAt = entry.lastStartedAt[target];
      if (
        lastStartedAt === undefined ||
        now - lastStartedAt >= this.cooldownMs[target]
      ) {
        due[target] = true;
        if (target === "overview" && entry.pending.uncertain)
          due.uncertain = true;
        entry.pending[target] = false;
        entry.lastStartedAt[target] = now;
      }
    }
    this.#scheduleTimer(entry);
    if (due.overview) this.dispatch(entry.key, due);
  }

  #scheduleTimer(entry: Entry): void {
    if (entry.timer !== undefined) {
      this.clock.clearTimeout(entry.timer);
      entry.timer = undefined;
    }
    const now = this.clock.now();
    const delays = targets(entry.pending).map((target) => {
      const lastStartedAt = entry.lastStartedAt[target];
      return lastStartedAt === undefined
        ? 0
        : Math.max(0, this.cooldownMs[target] - (now - lastStartedAt));
    });
    if (delays.length === 0) return;
    entry.timer = this.clock.setTimeout(
      () => {
        entry.timer = undefined;
        this.#dispatchDue(entry);
      },
      Math.min(...delays),
    );
  }
}

function targets(demand: GitAutoRefreshDemand): GitAutoRefreshTarget[] {
  return (["overview"] as const).filter((target) => Boolean(demand[target]));
}
