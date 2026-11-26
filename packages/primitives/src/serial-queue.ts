/**
 * What a queued task does after an earlier task in the same queue failed.
 *
 * - `isolate`: runs anyway; a failure only rejects its own caller.
 * - `halt`: the queue is poisoned; every later task rejects with the first
 *   failure without running, until `reset()`.
 */
export type SerialQueueErrorPolicy = "isolate" | "halt";

export interface SerialQueueOptions {
  /** Defaults to `isolate`. */
  readonly onError?: SerialQueueErrorPolicy;
}

/** Runs async tasks one at a time in call order. */
export class SerialQueue {
  readonly #policy: SerialQueueErrorPolicy;
  #tail: Promise<void> = Promise.resolve();
  #pending = 0;
  #failure: { readonly error: unknown } | undefined;

  constructor(options: SerialQueueOptions = {}) {
    this.#policy = options.onError ?? "isolate";
  }

  /** True while any task is running or waiting. */
  get busy(): boolean {
    return this.#pending > 0;
  }

  /** Queues `task`; resolves or rejects with its own outcome. */
  run<T>(task: () => T | Promise<T>): Promise<T> {
    this.#pending += 1;
    const result = this.#tail.then(async () => {
      if (this.#failure) throw this.#failure.error;
      try {
        return await task();
      } catch (error) {
        if (this.#policy === "halt") this.#failure = { error };
        throw error;
      }
    });
    this.#tail = result.then(
      () => {
        this.#pending -= 1;
      },
      () => {
        this.#pending -= 1;
      },
    );
    return result;
  }

  /** Resolves once everything queued so far has settled; never rejects. */
  idle(): Promise<void> {
    return this.#tail;
  }

  /** Clears a `halt` failure so later tasks run again. */
  reset(): void {
    this.#failure = undefined;
  }
}

/** One serial queue per key; tasks for different keys run concurrently. Idle keys are released. */
export class KeyedSerialQueue<K> {
  readonly #options: SerialQueueOptions;
  readonly #queues = new Map<K, SerialQueue>();

  constructor(options: SerialQueueOptions = {}) {
    this.#options = options;
  }

  /** Number of keys with queued or running work. */
  get size(): number {
    return this.#queues.size;
  }

  run<T>(key: K, task: () => T | Promise<T>): Promise<T> {
    let queue = this.#queues.get(key);
    if (!queue) {
      queue = new SerialQueue(this.#options);
      this.#queues.set(key, queue);
    }
    const active = queue;
    const result = active.run(task);
    void active.idle().then(() => {
      if (!active.busy && this.#queues.get(key) === active)
        this.#queues.delete(key);
    });
    return result;
  }

  /** Resolves once the work queued for `key` so far has settled; never rejects. */
  idle(key: K): Promise<void> {
    return this.#queues.get(key)?.idle() ?? Promise.resolve();
  }
}
