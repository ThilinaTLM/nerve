export type GitAutoRefreshDemand = {
  overview?: boolean;
  prs?: boolean;
};

export type GitAutoRefreshTarget = keyof GitAutoRefreshDemand;

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
  pending: Required<GitAutoRefreshDemand>;
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
    readonly cooldownMs: number,
    readonly dispatch: (key: string, demand: GitAutoRefreshDemand) => void,
    readonly clock: Clock = systemClock,
  ) {}

  schedule(key: string, demand: GitAutoRefreshDemand): void {
    const entry = this.#entry(key);
    entry.pending.overview ||= Boolean(demand.overview);
    entry.pending.prs ||= Boolean(demand.prs);
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
      pending: { overview: false, prs: false },
      lastStartedAt: { overview: undefined, prs: undefined },
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
        now - lastStartedAt >= this.cooldownMs
      ) {
        due[target] = true;
        entry.pending[target] = false;
        entry.lastStartedAt[target] = now;
      }
    }
    this.#scheduleTimer(entry);
    if (due.overview || due.prs) this.dispatch(entry.key, due);
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
        : Math.max(0, this.cooldownMs - (now - lastStartedAt));
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
  return (Object.keys(demand) as GitAutoRefreshTarget[]).filter((target) =>
    Boolean(demand[target]),
  );
}
