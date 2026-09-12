import type { LifecycleWork } from "@nervekit/contracts/runs";
import {
  LifecycleWorkExecutor,
  type LifecycleWorkExecutionResult,
  type LifecycleWorkHandler,
  type LifecycleWorkLeaseStore,
} from "./lifecycle-work-executor.js";

export interface LifecycleWorkStore extends LifecycleWorkLeaseStore {
  listDueLifecycleWork(now: string, limit: number): Promise<LifecycleWork[]>;
}

export interface LifecycleWorkConcurrency {
  model: number;
  control: number;
}

export interface LifecycleWorkDispatcherOptions {
  store: LifecycleWorkStore;
  bootId: string;
  handlers: Partial<Record<LifecycleWork["kind"], LifecycleWorkHandler>>;
  now?: () => Date;
  leaseDurationMs?: number;
  heartbeatIntervalMs?: number;
  /** Legacy single-lane capacity used by isolated callers and tests. */
  concurrency?: number;
  /** Independent production lanes prevent long model work from starving recovery. */
  concurrencyByLane?: LifecycleWorkConcurrency;
  onError?: (error: unknown, work: LifecycleWork) => void;
  onDrainError?: (error: unknown) => void;
  onLeaseLost?: (work: LifecycleWork) => void;
  onOutcomeUnknown?: (
    work: LifecycleWork,
    result: LifecycleWorkExecutionResult,
  ) => void | Promise<void>;
}

type ActiveExecution = {
  work: LifecycleWork;
  promise: Promise<void>;
};

/**
 * Immediately drains durable lifecycle work after a commit. Polling belongs to
 * the runtime recovery timer and is intentionally not part of this hot path.
 * Active slots are refilled on every wake and completion; unrelated long-lived
 * handlers never form a batch barrier for newly queued work.
 */
export class LifecycleWorkDispatcher {
  private draining?: Promise<void>;
  private pendingWake = false;
  private readonly wakeWaiters = new Set<() => void>();
  private pollTimer?: NodeJS.Timeout;
  private readonly executor: LifecycleWorkExecutor;

  constructor(private readonly options: LifecycleWorkDispatcherOptions) {
    this.executor = new LifecycleWorkExecutor(options);
  }

  /** Starts recovery work without making daemon readiness depend on its duration. */
  start(intervalMs = 5_000): void {
    this.startPolling(intervalMs);
    this.trigger();
  }

  startPolling(intervalMs = 5_000): void {
    if (this.pollTimer) return;
    this.pollTimer = setInterval(() => this.trigger(), intervalMs);
    this.pollTimer.unref();
  }

  /** Requests a drain and reports infrastructure failures without an unhandled rejection. */
  trigger(): void {
    void this.wake().catch((error) => this.options.onDrainError?.(error));
  }

  stopPolling(): void {
    if (!this.pollTimer) return;
    clearInterval(this.pollTimer);
    this.pollTimer = undefined;
  }

  settled(): Promise<void> {
    return this.draining ?? Promise.resolve();
  }

  wake(): Promise<void> {
    this.pendingWake = true;
    for (const notify of this.wakeWaiters) notify();
    this.wakeWaiters.clear();
    if (!this.draining) {
      this.draining = this.drainUntilStable().finally(() => {
        this.draining = undefined;
      });
    }
    return this.draining;
  }

  private async drainUntilStable(): Promise<void> {
    do {
      await this.drain();
    } while (this.pendingWake);
  }

  private async drain(): Promise<void> {
    const active = new Map<string, ActiveExecution>();
    const pending = new Map<string, LifecycleWork>();

    while (true) {
      if (this.pendingWake) {
        this.pendingWake = false;
        const now = (this.options.now ?? (() => new Date()))();
        const due = await this.options.store.listDueLifecycleWork(
          now.toISOString(),
          100,
        );
        for (const work of due) {
          if (!active.has(work.id) && !pending.has(work.id)) {
            pending.set(work.id, work);
          }
        }
      }

      this.launchAvailable(pending, active);

      if (active.size === 0) {
        if (this.pendingWake) continue;
        return;
      }
      if (this.pendingWake) continue;

      await this.waitForWakeOrCompletion(active);
      // A completion may expose more persisted work beyond the last page.
      this.pendingWake = true;
    }
  }

  private launchAvailable(
    pending: Map<string, LifecycleWork>,
    active: Map<string, ActiveExecution>,
  ): void {
    let launched = true;
    while (launched) {
      launched = false;
      for (const [id, work] of pending) {
        const handler = this.options.handlers[work.kind];
        if (!handler) {
          pending.delete(id);
          continue;
        }
        if (!this.hasLaneCapacity(work, active)) continue;

        pending.delete(id);
        const promise = this.executor
          .execute(work, handler)
          .catch((error) => this.options.onError?.(error, work))
          .then(() => undefined)
          .finally(() => {
            active.delete(id);
          });
        active.set(id, { work, promise });
        launched = true;
      }
    }
  }

  private hasLaneCapacity(
    work: LifecycleWork,
    active: Map<string, ActiveExecution>,
  ): boolean {
    const lane = this.laneFor(work);
    let activeInLane = 0;
    for (const execution of active.values()) {
      if (this.laneFor(execution.work) === lane) activeInLane += 1;
    }
    return activeInLane < this.laneCapacity(lane);
  }

  private laneFor(work: LifecycleWork): "default" | "model" | "control" {
    if (!this.options.concurrencyByLane) return "default";
    return work.kind === "continue_model" ? "model" : "control";
  }

  private laneCapacity(lane: "default" | "model" | "control"): number {
    if (lane === "model") {
      return Math.max(1, this.options.concurrencyByLane?.model ?? 1);
    }
    if (lane === "control") {
      return Math.max(1, this.options.concurrencyByLane?.control ?? 1);
    }
    return Math.max(1, this.options.concurrency ?? 4);
  }

  private waitForWakeOrCompletion(
    active: Map<string, ActiveExecution>,
  ): Promise<void> {
    return new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        this.wakeWaiters.delete(finish);
        resolve();
      };
      this.wakeWaiters.add(finish);
      for (const execution of active.values()) {
        void execution.promise.then(finish);
      }
      if (this.pendingWake) finish();
    });
  }
}
