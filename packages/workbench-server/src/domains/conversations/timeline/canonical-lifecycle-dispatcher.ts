import type { CanonicalLifecycleWork } from "@nervekit/contracts/runs";
import type { ApplicationLogger } from "../../../infrastructure/diagnostics/index.js";
import type { CanonicalStore } from "../../../infrastructure/persistence/canonical-sqlite/canonical-store.js";

const BATCH_SIZE = 32;

/** Claims durable canonical obligations and delegates external work by kind. */
export class CanonicalLifecycleDispatcher {
  private timer?: ReturnType<typeof setInterval>;
  private running?: Promise<void>;
  private stopped = false;

  constructor(
    private readonly store: CanonicalStore,
    private readonly workerId: string,
    private readonly handlers: Partial<
      Record<
        CanonicalLifecycleWork["kind"],
        (work: CanonicalLifecycleWork) => Promise<void>
      >
    >,
    private readonly logger: Pick<ApplicationLogger, "warn">,
  ) {}

  start(intervalMs = 250): void {
    if (this.timer || this.stopped) return;
    this.timer = setInterval(() => this.wake(), intervalMs);
    this.timer.unref?.();
    this.wake();
  }

  wake(): void {
    if (this.stopped || this.running) return;
    this.running = this.runBatch().finally(() => {
      this.running = undefined;
    });
  }

  async settled(): Promise<void> {
    await this.running;
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    await this.running;
  }

  private async runBatch(): Promise<void> {
    const now = new Date().toISOString();
    try {
      await this.store.execution.recoverExpiredLifecycleWork({
        now,
        limit: BATCH_SIZE,
      });
      const ready = await this.store.execution.listReadyLifecycleWork(
        now,
        BATCH_SIZE,
      );
      for (const candidate of ready) {
        if (this.stopped) return;
        const handler = this.handlers[candidate.kind];
        if (!handler) continue;
        const work = await this.store.execution.claimReadyLifecycleWork({
          workId: candidate.workId,
          workerId: this.workerId,
          now: new Date().toISOString(),
          leaseDurationMs: 60_000,
        });
        if (!work) continue;
        try {
          await handler(work);
        } catch (error) {
          await this.logger.warn("Canonical lifecycle work failed", {
            error,
            context: {
              workId: work.workId,
              kind: work.kind,
              conversationId: work.conversationId,
              runId: work.runId,
            },
          });
        }
      }
    } catch (error) {
      await this.logger.warn("Canonical lifecycle dispatcher failed", {
        error,
      });
    }
  }
}
