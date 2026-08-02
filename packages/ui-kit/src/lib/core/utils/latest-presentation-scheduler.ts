export type PresentationClock<Handle = ReturnType<typeof setTimeout>> = {
  now: () => number;
  schedule: (callback: () => void, delayMs: number) => Handle;
  cancel: (handle: Handle) => void;
};

const defaultClock: PresentationClock = {
  now: () => Date.now(),
  schedule: (callback, delayMs) => setTimeout(callback, delayMs),
  cancel: (handle) => clearTimeout(handle),
};

/**
 * Commits the latest presentation value at a bounded cadence.
 * Canonical state remains immediate; superseded values are visual snapshots.
 */
export class LatestPresentationScheduler<
  T,
  Handle = ReturnType<typeof setTimeout>,
> {
  private pending: T | undefined;
  private hasPending = false;
  private timer: Handle | undefined;
  private lastCommitAt: number | undefined;
  private destroyed = false;

  constructor(
    private readonly commit: (value: T) => void,
    private readonly intervalMs = 75,
    private readonly clock: PresentationClock<Handle> = defaultClock as unknown as PresentationClock<Handle>,
  ) {}

  enqueue(value: T, options: { priority?: boolean } = {}): void {
    if (this.destroyed) return;
    this.pending = value;
    this.hasPending = true;
    if (options.priority || this.lastCommitAt === undefined) {
      this.flushNow();
      return;
    }
    if (this.timer !== undefined) return;
    const elapsed = this.clock.now() - this.lastCommitAt;
    this.timer = this.clock.schedule(
      () => {
        this.timer = undefined;
        this.commitPending();
      },
      Math.max(0, this.intervalMs - elapsed),
    );
  }

  flushNow(value?: T): void {
    if (this.destroyed) return;
    if (arguments.length > 0) {
      this.pending = value as T;
      this.hasPending = true;
    }
    this.cancelTimer();
    this.commitPending();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.cancelTimer();
    this.pending = undefined;
    this.hasPending = false;
  }

  private cancelTimer(): void {
    if (this.timer === undefined) return;
    this.clock.cancel(this.timer);
    this.timer = undefined;
  }

  private commitPending(): void {
    if (!this.hasPending) return;
    const value = this.pending as T;
    this.pending = undefined;
    this.hasPending = false;
    this.lastCommitAt = this.clock.now();
    this.commit(value);
  }
}
