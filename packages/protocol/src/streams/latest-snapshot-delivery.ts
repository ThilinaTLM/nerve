import type { ProtocolClock, ProtocolTimers } from "../runtime/ports.js";
import {
  systemProtocolClock,
  systemProtocolTimers,
} from "../runtime/system-runtime.js";

type Snapshot<T> = {
  key: string;
  value: T;
  bytes: number;
  cancelled?: boolean;
};
type Job<T> = {
  snapshots: Snapshot<T>[];
  run?: () => Promise<void>;
  bytes: number;
};

/** One asynchronous worker, one cadence timer, and a bounded latest-only inbox.
 * Ordered fences capture snapshots before subsequent authoritative writes.
 * Producers never allocate a promise or wait for the sender.
 */
export class LatestSnapshotDelivery<T> {
  readonly #pending = new Map<string, Snapshot<T>>();
  readonly #jobs: Job<T>[] = [];
  readonly #clock: ProtocolClock;
  readonly #timers: ProtocolTimers;
  #bytes = 0;
  #count = 0;
  #running = false;
  #scheduled = false;
  #disposed = false;
  #timer?: unknown;
  #nextSend = 0;
  #activeSnapshots: Snapshot<T>[] = [];

  constructor(
    private readonly options: {
      intervalMs: number;
      maxItems: number;
      maxBytes: number;
      send: (value: T) => Promise<void>;
      onError: (error: unknown) => void;
      onOverflow?: () => void;
      clock?: ProtocolClock;
      timers?: ProtocolTimers;
    },
  ) {
    this.#clock = options.clock ?? systemProtocolClock;
    this.#timers = options.timers ?? systemProtocolTimers;
  }

  snapshot(key: string, value: T, bytes: number): void {
    if (this.#disposed) return;
    const previous = this.#pending.get(key);
    if (previous) this.#bytes -= previous.bytes;
    else this.#count++;
    this.#pending.set(key, { key, value, bytes });
    this.#bytes += bytes;
    if (this.#checkBounds()) this.#schedule();
  }

  /** Queue an intact, non-replaceable write. */
  enqueue(run: () => Promise<void>, bytes: number): void {
    if (this.#disposed) return;
    this.#jobs.push({ snapshots: [], run, bytes });
    this.#bytes += bytes;
    this.#count++;
    if (this.#checkBounds()) this.#schedule();
  }

  /** Capture the latest matching snapshots and send them before the fence. */
  fence(
    matches: (key: string) => boolean,
    run: () => Promise<void>,
    bytes: number,
  ): void {
    if (this.#disposed) return;
    const snapshots: Snapshot<T>[] = [];
    for (const [key, snapshot] of this.#pending) {
      if (!matches(key)) continue;
      this.#pending.delete(key);
      snapshots.push(snapshot);
    }
    this.#jobs.push({ snapshots, run, bytes });
    this.#bytes += bytes;
    this.#count++;
    if (this.#checkBounds()) this.#schedule();
  }

  /** Invalidate unsent previews, including those already captured by a fence. */
  drop(matches: (key: string) => boolean): void {
    for (const snapshot of this.#activeSnapshots) {
      if (matches(snapshot.key)) snapshot.cancelled = true;
    }
    for (const [key, snapshot] of this.#pending) {
      if (!matches(key)) continue;
      this.#pending.delete(key);
      this.#release(snapshot.bytes);
    }
    for (const job of this.#jobs) {
      job.snapshots = job.snapshots.filter((snapshot) => {
        if (!matches(snapshot.key)) return true;
        this.#release(snapshot.bytes);
        return false;
      });
    }
    if (!this.#pending.size) this.#clearTimer();
  }

  dispose(): void {
    this.#disposed = true;
    this.#clearTimer();
    this.#pending.clear();
    this.#jobs.length = 0;
    this.#bytes = 0;
    this.#count = 0;
  }

  #checkBounds(): boolean {
    if (
      this.#count <= this.options.maxItems &&
      this.#bytes <= this.options.maxBytes
    )
      return true;
    this.dispose();
    if (this.options.onOverflow) this.options.onOverflow();
    else
      this.options.onError(
        new Error("Outgoing presentation buffer overflow; resync required"),
      );
    return false;
  }

  #release(bytes: number): void {
    this.#bytes -= bytes;
    this.#count--;
  }

  #clearTimer(): void {
    if (this.#timer !== undefined) this.#timers.clearTimeout(this.#timer);
    this.#timer = undefined;
  }

  #schedule(): void {
    if (this.#running || this.#scheduled || this.#disposed) return;
    this.#scheduled = true;
    queueMicrotask(() => {
      this.#scheduled = false;
      if (!this.#disposed) void this.#drain();
    });
  }

  async #drain(): Promise<void> {
    if (this.#running) return;
    this.#running = true;
    try {
      while (!this.#disposed) {
        const job = this.#jobs.shift();
        if (job) {
          // Keep the active job charged to the budget until delivery completes.
          this.#activeSnapshots = job.snapshots;
          for (const snapshot of job.snapshots) {
            if (this.#disposed) return;
            if (!snapshot.cancelled) await this.options.send(snapshot.value);
          }
          this.#activeSnapshots = [];
          if (this.#disposed) return;
          await job.run?.();
          if (this.#disposed) return;
          for (const snapshot of job.snapshots) this.#release(snapshot.bytes);
          this.#release(job.bytes);
          continue;
        }
        if (!this.#pending.size) return;
        const wait = this.#nextSend - this.#clock.now();
        if (wait > 0) {
          if (this.#timer === undefined)
            this.#timer = this.#timers.setTimeout(() => {
              this.#timer = undefined;
              this.#schedule();
            }, wait);
          return;
        }
        this.#clearTimer();
        this.#nextSend = this.#clock.now() + this.options.intervalMs;
        // Schedule keys, not captured prefixes: a slow write for one call must
        // not freeze obsolete snapshots for the other calls behind it.
        const keys = [...this.#pending.keys()];
        for (const key of keys) {
          if (this.#disposed) return;
          const snapshot = this.#pending.get(key);
          if (!snapshot) continue;
          this.#pending.delete(key);
          this.#activeSnapshots = [snapshot];
          await this.options.send(snapshot.value);
          if (this.#disposed) return;
          this.#release(snapshot.bytes);
        }
        this.#activeSnapshots = [];
      }
    } catch (error) {
      this.dispose();
      this.options.onError(error);
    } finally {
      this.#running = false;
    }
  }
}
