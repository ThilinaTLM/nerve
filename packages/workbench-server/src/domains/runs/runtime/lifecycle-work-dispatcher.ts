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

export interface LifecycleWorkDispatcherOptions {
  store: LifecycleWorkStore;
  bootId: string;
  handlers: Partial<Record<LifecycleWork["kind"], LifecycleWorkHandler>>;
  now?: () => Date;
  leaseDurationMs?: number;
  heartbeatIntervalMs?: number;
  concurrency?: number;
  onError?: (error: unknown, work: LifecycleWork) => void;
  onLeaseLost?: (work: LifecycleWork) => void;
  onOutcomeUnknown?: (
    work: LifecycleWork,
    result: LifecycleWorkExecutionResult,
  ) => void | Promise<void>;
}

/**
 * Immediately drains durable lifecycle work after a commit. Polling belongs to
 * the runtime recovery timer and is intentionally not part of this hot path.
 */
export class LifecycleWorkDispatcher {
  private draining?: Promise<void>;
  private pendingWake = false;
  private pollTimer?: NodeJS.Timeout;
  private readonly executor: LifecycleWorkExecutor;

  constructor(private readonly options: LifecycleWorkDispatcherOptions) {
    this.executor = new LifecycleWorkExecutor(options);
  }

  startPolling(intervalMs = 5_000): void {
    if (this.pollTimer) return;
    this.pollTimer = setInterval(() => void this.wake(), intervalMs);
    this.pollTimer.unref();
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
    if (!this.draining) {
      this.draining = this.drain().finally(() => {
        this.draining = undefined;
      });
    }
    return this.draining;
  }

  private async drain(): Promise<void> {
    do {
      this.pendingWake = false;
      const now = (this.options.now ?? (() => new Date()))();
      const due = await this.options.store.listDueLifecycleWork(
        now.toISOString(),
        100,
      );
      const concurrency = Math.max(1, this.options.concurrency ?? 4);
      for (let index = 0; index < due.length; index += concurrency) {
        await Promise.all(
          due.slice(index, index + concurrency).map((work) => {
            const handler = this.options.handlers[work.kind];
            if (!handler) return Promise.resolve();
            return this.executor.execute(work, handler).catch((error) => {
              this.options.onError?.(error, work);
            });
          }),
        );
      }
      if (due.length === 100) this.pendingWake = true;
    } while (this.pendingWake);
  }
}
