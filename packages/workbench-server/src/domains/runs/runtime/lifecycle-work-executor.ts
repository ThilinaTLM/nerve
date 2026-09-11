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

export interface LifecycleWorkLeaseStore {
  claimLifecycleWork(input: {
    workId: string;
    expectedGeneration: number;
    leaseOwner: string;
    leaseDeadline: string;
    now: string;
  }): Promise<LifecycleWork | undefined>;
  renewLifecycleWork(input: {
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

export interface LifecycleWorkExecutorOptions {
  store: LifecycleWorkLeaseStore;
  bootId: string;
  now?: () => Date;
  leaseDurationMs?: number;
  heartbeatIntervalMs?: number;
  onLeaseLost?: (work: LifecycleWork) => void;
}

/** Owns one claim/heartbeat/effect/fenced-settlement cycle. */
export class LifecycleWorkExecutor {
  constructor(private readonly options: LifecycleWorkExecutorOptions) {}

  async execute(
    work: LifecycleWork,
    handler: LifecycleWorkHandler,
  ): Promise<void> {
    const claimedAt = this.now();
    const claimed = await this.options.store.claimLifecycleWork({
      workId: work.id,
      expectedGeneration: work.generation,
      leaseOwner: this.options.bootId,
      leaseDeadline: this.deadline(claimedAt),
      now: claimedAt.toISOString(),
    });
    if (!claimed) return;

    let leaseOwned = true;
    let renewal: Promise<void> | undefined;
    const heartbeat = setInterval(() => {
      if (renewal) return;
      const heartbeatAt = this.now();
      renewal = this.options.store
        .renewLifecycleWork({
          workId: claimed.id,
          expectedGeneration: claimed.generation,
          leaseOwner: this.options.bootId,
          leaseDeadline: this.deadline(heartbeatAt),
          now: heartbeatAt.toISOString(),
        })
        .then((renewed) => {
          if (!renewed) leaseOwned = false;
        })
        .catch(() => {
          leaseOwned = false;
        })
        .finally(() => {
          renewal = undefined;
        });
    }, this.options.heartbeatIntervalMs ?? 10_000);
    heartbeat.unref();

    let result: LifecycleWorkExecutionResult;
    try {
      result = await handler(claimed);
    } catch (error) {
      result = {
        state: work.kind === "execute_tool" ? "outcome_unknown" : "failed",
        lastError: error instanceof Error ? error.message : String(error),
      };
    } finally {
      clearInterval(heartbeat);
      await renewal;
    }
    if (!leaseOwned) {
      this.options.onLeaseLost?.(claimed);
      return;
    }
    const settled = await this.options.store.settleLifecycleWork({
      workId: claimed.id,
      expectedGeneration: claimed.generation,
      leaseOwner: this.options.bootId,
      state: result.state,
      now: this.now().toISOString(),
      lastError: result.lastError,
      externalLocator: result.externalLocator,
    });
    if (!settled) this.options.onLeaseLost?.(claimed);
  }

  private now(): Date {
    return (this.options.now ?? (() => new Date()))();
  }

  private deadline(now: Date): string {
    return new Date(
      now.getTime() + (this.options.leaseDurationMs ?? 30_000),
    ).toISOString();
  }
}
