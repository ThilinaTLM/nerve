import type { ApplicationLogger } from "../../../infrastructure/diagnostics/index.js";
import { CanonicalTranscriptProjectionService } from "./canonical-transcript-projection.service.js";

const DEFAULT_INTERVAL_MS = 250;
const DEFAULT_BATCH_SIZE = 10;

/** Drains durable projection watermarks without becoming mutation authority. */
export class CanonicalProjectionDispatcher {
  private timer?: ReturnType<typeof setInterval>;
  private running?: Promise<void>;
  private stopped = false;

  constructor(
    private readonly projections: CanonicalTranscriptProjectionService,
    private readonly logger: Pick<ApplicationLogger, "warn">,
  ) {}

  start(intervalMs = DEFAULT_INTERVAL_MS): void {
    if (this.timer || this.stopped) return;
    this.timer = setInterval(() => this.wake(), intervalMs);
    this.timer.unref?.();
    this.wake();
  }

  wake(): void {
    if (this.stopped || this.running) return;
    this.running = this.drain().finally(() => {
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

  private async drain(): Promise<void> {
    try {
      while (!this.stopped) {
        const rebuilt =
          await this.projections.rebuildPending(DEFAULT_BATCH_SIZE);
        if (rebuilt.length < DEFAULT_BATCH_SIZE) return;
      }
    } catch (error) {
      await this.logger.warn("Canonical projection rebuild failed", { error });
    }
  }
}
