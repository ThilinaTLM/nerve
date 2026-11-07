/**
 * Batches DOM measurements across component instances into one animation
 * frame: every queued read runs first, then every queued apply, so writes
 * from one instance never force layout for another's reads.
 */
export type MeasureTask<T> = {
  /** Reads layout only. Returning undefined skips apply. */
  read: () => T | undefined;
  /** May write state/DOM; runs after all reads in the batch. */
  apply: (value: T) => void;
};

type Scheduler = {
  request: (callback: () => void) => number;
  cancel: (handle: number) => void;
};

const browserScheduler: Scheduler = {
  request: (callback) => requestAnimationFrame(callback),
  cancel: (handle) => cancelAnimationFrame(handle),
};

export class MeasureBatch {
  // Keyed by owner so re-queuing replaces the pending task instead of stacking.
  readonly #tasks = new Map<object, MeasureTask<unknown>>();
  #frame: number | undefined;
  readonly #scheduler: Scheduler | undefined;

  constructor(scheduler?: Scheduler) {
    this.#scheduler = scheduler;
  }

  queue<T>(owner: object, task: MeasureTask<T>): void {
    this.#tasks.set(owner, task as MeasureTask<unknown>);
    if (this.#frame !== undefined) return;
    const scheduler =
      this.#scheduler ??
      (typeof requestAnimationFrame === "undefined"
        ? undefined
        : browserScheduler);
    if (!scheduler) {
      this.flush();
      return;
    }
    this.#frame = scheduler.request(() => {
      this.#frame = undefined;
      this.flush();
    });
  }

  cancel(owner: object): void {
    this.#tasks.delete(owner);
    if (this.#tasks.size === 0 && this.#frame !== undefined) {
      (this.#scheduler ?? browserScheduler).cancel(this.#frame);
      this.#frame = undefined;
    }
  }

  flush(): void {
    const tasks = [...this.#tasks.values()];
    this.#tasks.clear();
    const reads = tasks.map((task) => ({ task, value: task.read() }));
    for (const { task, value } of reads) {
      if (value !== undefined) task.apply(value);
    }
  }
}

export const sharedMeasureBatch = new MeasureBatch();
