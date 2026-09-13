import type { ApplicationLogger } from "../../../infrastructure/diagnostics/index.js";
import type { CanonicalStore } from "../../../infrastructure/persistence/canonical-sqlite/canonical-store.js";
import { CanonicalDeletionCleanupService } from "./canonical-deletion-cleanup.service.js";

const BATCH_SIZE = 100;

/** Advances durable deletion cursors in bounded, restart-safe work units. */
export class CanonicalDeletionDispatcher {
  private timer?: ReturnType<typeof setInterval>;
  private running?: Promise<void>;
  private stopped = false;

  constructor(
    private readonly store: CanonicalStore,
    private readonly cleanup: CanonicalDeletionCleanupService,
    private readonly logger: Pick<ApplicationLogger, "warn">,
  ) {}

  start(intervalMs = 500): void {
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
    try {
      const conversationIds = await this.store.deletion.listPending(BATCH_SIZE);
      for (const conversationId of conversationIds) {
        if (this.stopped) return;
        await this.cleanup.advance({ conversationId, limit: BATCH_SIZE });
      }
    } catch (error) {
      await this.logger.warn("Canonical deletion cleanup failed", { error });
    }
  }
}
