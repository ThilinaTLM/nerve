import type {
  LifecycleWork,
  LifecycleWorkState,
} from "@nervekit/contracts/runs";
export interface LifecycleWorkExecutionResult {
  state: Extract<
    LifecycleWorkState,
    "succeeded" | "failed" | "cancelled" | "outcome_unknown"
  >;
  lastError?: string;
  externalLocator?: string;
}

export type LifecycleWorkHandler = (
  work: LifecycleWork,
) => Promise<LifecycleWorkExecutionResult>;

export interface LifecycleWorkStore {
  listDueLifecycleWork(now: string, limit: number): Promise<LifecycleWork[]>;
  claimLifecycleWork(input: {
    workId: string;
    expectedGeneration: number;
    leaseOwner: string;
    leaseDeadline: string;
    now: string;
  }): Promise<LifecycleWork | undefined>;
  settleLifecycleWork(input: {
    workId: string;
    expectedGeneration: number;
    leaseOwner: string;
    state: LifecycleWorkExecutionResult["state"];
    now: string;
    lastError?: string;
    externalLocator?: string;
  }): Promise<LifecycleWork | undefined>;
}

export interface LifecycleWorkDispatcherOptions {
  store: LifecycleWorkStore;
  bootId: string;
  handlers: Partial<Record<LifecycleWork["kind"], LifecycleWorkHandler>>;
  now?: () => Date;
  leaseDurationMs?: number;
  concurrency?: number;
  onError?: (error: unknown, work: LifecycleWork) => void;
}

/**
 * Immediately drains durable lifecycle work after a commit. Polling belongs to
 * the runtime recovery timer and is intentionally not part of this hot path.
 */
export class LifecycleWorkDispatcher {
  private draining?: Promise<void>;
  private pendingWake = false;

  constructor(private readonly options: LifecycleWorkDispatcherOptions) {}

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
          due.slice(index, index + concurrency).map((work) =>
            this.execute(work, now).catch((error) => {
              this.options.onError?.(error, work);
            }),
          ),
        );
      }
      if (due.length === 100) this.pendingWake = true;
    } while (this.pendingWake);
  }

  private async execute(work: LifecycleWork, claimedAt: Date): Promise<void> {
    const handler = this.options.handlers[work.kind];
    if (!handler) return;
    const leaseDurationMs = this.options.leaseDurationMs ?? 30_000;
    const claimed = await this.options.store.claimLifecycleWork({
      workId: work.id,
      expectedGeneration: work.generation,
      leaseOwner: this.options.bootId,
      leaseDeadline: new Date(
        claimedAt.getTime() + leaseDurationMs,
      ).toISOString(),
      now: claimedAt.toISOString(),
    });
    if (!claimed) return;
    let result: LifecycleWorkExecutionResult;
    try {
      result = await handler(claimed);
    } catch (error) {
      result = {
        state: "failed",
        lastError: error instanceof Error ? error.message : String(error),
      };
    }
    const now = (this.options.now ?? (() => new Date()))().toISOString();
    await this.options.store.settleLifecycleWork({
      workId: claimed.id,
      expectedGeneration: claimed.generation,
      leaseOwner: this.options.bootId,
      state: result.state,
      now,
      lastError: result.lastError,
      externalLocator: result.externalLocator,
    });
  }
}
