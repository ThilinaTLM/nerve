import type { BackgroundJob } from "@nervekit/contracts/background-jobs";

/** One piece of periodic daemon work. A job is a sweep: each run does whatever its domain finds due. */
export interface BackgroundJobDefinition {
  /** Stable, e.g. `accounts.credential-refresh`. */
  id: string;
  label: string;
  description: string;
  intervalMs: number;
  /** Per run; the run's abort signal fires when it passes. */
  timeoutMs: number;
  /** Returns a short summary for Settings, or throws. Must not put secrets in either. */
  run(signal: AbortSignal): Promise<string> | string;
}

/** Wall-clock and timer seam; tests drive it by hand. Timers return their cancel function. */
export interface BackgroundJobClock {
  now(): number;
  setInterval(callback: () => void, ms: number): () => void;
  setTimeout(callback: () => void, ms: number): () => void;
}

const systemBackgroundJobClock: BackgroundJobClock = {
  now: () => Date.now(),
  setInterval: (callback, ms) => {
    const timer = setInterval(callback, ms);
    timer.unref();
    return () => clearInterval(timer);
  },
  setTimeout: (callback, ms) => {
    const timer = setTimeout(callback, ms);
    timer.unref();
    return () => clearTimeout(timer);
  },
};

const BACKGROUND_JOB_TICK_MS = 30_000;
const SHUTDOWN_GRACE_MS = 5_000;
/** Consecutive failures before the user is told. */
export const BACKGROUND_JOB_NOTICE_AFTER_FAILURES = 3;

interface JobState {
  job: BackgroundJobDefinition;
  nextRunAt: number;
  failures: number;
  queued: boolean;
  running?: { startedAt: number; controller: AbortController };
  lastRun?: BackgroundJob["lastRun"];
}

export interface BackgroundJobServiceOptions {
  clock?: BackgroundJobClock;
  /** Called after every state change with the full list. */
  onChanged?: (jobs: BackgroundJob[]) => void;
  /** Called when a job fails or recovers; `failures` is the consecutive failure count (0 = recovered). */
  onOutcome?: (
    job: BackgroundJobDefinition,
    failures: number,
    error?: string,
  ) => void;
  log?: (message: string, context: { jobId: string; error?: string }) => void;
  tickMs?: number;
  shutdownGraceMs?: number;
}

/**
 * Runs registered jobs on one wall-clock ticker, one at a time. State lives in
 * memory only: after a start or a sleep every overdue job runs once on the next tick.
 */
export class BackgroundJobService {
  readonly #jobs = new Map<string, JobState>();
  readonly #queue: JobState[] = [];
  readonly #clock: BackgroundJobClock;
  readonly #tickMs: number;
  readonly #graceMs: number;
  #stopTicker?: () => void;
  #pump?: Promise<void>;
  #stopped = false;

  constructor(private readonly options: BackgroundJobServiceOptions = {}) {
    this.#clock = options.clock ?? systemBackgroundJobClock;
    this.#tickMs = options.tickMs ?? BACKGROUND_JOB_TICK_MS;
    this.#graceMs = options.shutdownGraceMs ?? SHUTDOWN_GRACE_MS;
  }

  /** Registers before `start()`; a job registered later is due on the next tick. */
  register(job: BackgroundJobDefinition): void {
    if (this.#stopped) throw new Error("Background jobs are stopped.");
    if (this.#jobs.has(job.id))
      throw new Error(`Background job already registered: ${job.id}`);
    this.#jobs.set(job.id, {
      job,
      nextRunAt: 0,
      failures: 0,
      queued: false,
    });
  }

  /** Call once storage and migrations are ready. The first tick runs every job. */
  start(): void {
    if (this.#stopTicker || this.#stopped) return;
    this.#stopTicker = this.#clock.setInterval(() => this.tick(), this.#tickMs);
    this.tick();
  }

  list(): BackgroundJob[] {
    return [...this.#jobs.values()].map((state) => this.#snapshot(state));
  }

  /** Queues a run now unless the job is already running or queued. */
  runNow(jobId: string): BackgroundJob {
    const state = this.#jobs.get(jobId);
    if (!state) throw new Error(`Unknown background job: ${jobId}`);
    if (this.#stopped) throw new Error("Background jobs are stopped.");
    if (!state.running && !state.queued) this.#enqueue(state, true);
    return this.#snapshot(state);
  }

  /** Starts every job whose time has passed; exposed for the ticker and tests. */
  tick(): void {
    if (this.#stopped) return;
    const now = this.#clock.now();
    for (const state of this.#jobs.values())
      if (!state.running && !state.queued && state.nextRunAt <= now)
        this.#enqueue(state, false);
  }

  /** No new runs start; running ones are aborted and awaited for a bounded time. */
  async stop(): Promise<void> {
    this.#stopped = true;
    this.#stopTicker?.();
    this.#stopTicker = undefined;
    for (const state of this.#queue.splice(0)) state.queued = false;
    for (const state of this.#jobs.values()) state.running?.controller.abort();
    const pump = this.#pump;
    if (!pump) return;
    let cancel: (() => void) | undefined;
    const grace = new Promise<void>((resolve) => {
      cancel = this.#clock.setTimeout(resolve, this.#graceMs);
    });
    await Promise.race([pump, grace]);
    cancel?.();
  }

  #enqueue(state: JobState, first: boolean): void {
    state.queued = true;
    if (first) this.#queue.unshift(state);
    else this.#queue.push(state);
    this.#changed();
    this.#pump ??= this.#drain().finally(() => {
      this.#pump = undefined;
    });
  }

  async #drain(): Promise<void> {
    for (let state = this.#queue.shift(); state; state = this.#queue.shift()) {
      state.queued = false;
      if (this.#stopped) return;
      await this.#run(state);
    }
  }

  async #run(state: JobState): Promise<void> {
    const { job } = state;
    const controller = new AbortController();
    const startedAt = this.#clock.now();
    state.running = { startedAt, controller };
    this.#changed();
    let cancelTimeout: (() => void) | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      cancelTimeout = this.#clock.setTimeout(() => {
        const error = new Error(
          `Timed out after ${formatDuration(job.timeoutMs)}`,
        );
        controller.abort(error);
        reject(error);
      }, job.timeoutMs);
    });
    let outcome: NonNullable<BackgroundJob["lastRun"]>["outcome"];
    try {
      const summary = await Promise.race([
        Promise.resolve().then(() => job.run(controller.signal)),
        timeout,
      ]);
      outcome = { ok: true, summary };
    } catch (error) {
      outcome = { ok: false, error: errorMessage(error) };
    } finally {
      cancelTimeout?.();
    }
    const finishedAt = this.#clock.now();
    state.running = undefined;
    state.lastRun = {
      startedAt: new Date(startedAt).toISOString(),
      durationMs: Math.max(0, finishedAt - startedAt),
      outcome,
    };
    if (outcome.ok) {
      state.failures = 0;
      state.nextRunAt = finishedAt + job.intervalMs;
    } else {
      state.failures += 1;
      state.nextRunAt =
        finishedAt + backoffMs(job, state.failures, this.#tickMs);
    }
    this.#log(job.id, outcome);
    this.#changed();
    try {
      this.options.onOutcome?.(
        job,
        state.failures,
        outcome.ok ? undefined : outcome.error,
      );
    } catch {
      /* Reporting cannot break the queue. */
    }
  }

  #snapshot(state: JobState): BackgroundJob {
    const { job } = state;
    return {
      id: job.id,
      label: job.label,
      description: job.description,
      intervalMs: job.intervalMs,
      status: state.running
        ? "running"
        : state.failures > 0
          ? "failing"
          : "idle",
      runningSince: state.running
        ? new Date(state.running.startedAt).toISOString()
        : undefined,
      lastRun: state.lastRun,
      nextRun:
        state.running || state.nextRunAt === 0
          ? undefined
          : new Date(state.nextRunAt).toISOString(),
    };
  }

  #changed(): void {
    try {
      this.options.onChanged?.(this.list());
    } catch {
      /* Publishing is best effort. */
    }
  }

  #log(
    jobId: string,
    outcome: NonNullable<BackgroundJob["lastRun"]>["outcome"],
  ): void {
    if (outcome.ok) return;
    this.options.log?.("Background job failed", {
      jobId,
      error: outcome.error,
    });
  }
}

/** Doubles from one tick up to the job's interval. */
function backoffMs(
  job: BackgroundJobDefinition,
  failures: number,
  baseMs: number,
): number {
  return Math.min(job.intervalMs, baseMs * 2 ** Math.min(failures - 1, 30));
}

function formatDuration(ms: number): string {
  return ms % 60_000 === 0
    ? `${ms / 60_000} min`
    : `${Math.round(ms / 1000)} s`;
}

function errorMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 500);
}
