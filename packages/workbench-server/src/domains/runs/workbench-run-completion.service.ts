import type { EventEnvelope } from "@nervekit/contracts";
import type { StreamLogRegistry } from "../../infrastructure/events/index.js";
import type { ApplicationLogger } from "../../infrastructure/diagnostics/index.js";

export class WorkbenchRunCompletionService {
  private readonly handled = new Set<string>();
  private tail: Promise<void> = Promise.resolve();
  private unsubscribe?: () => void;

  constructor(
    private readonly events: StreamLogRegistry,
    private readonly maybeAutoCompact: (
      conversationId: string,
      agentId: string,
      runId: string,
    ) => Promise<void>,
    private readonly logger?: ApplicationLogger,
  ) {}

  start(): void {
    if (this.unsubscribe) return;
    this.unsubscribe = this.events.subscribe((event) => this.onEvent(event));
  }

  stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
  }

  private onEvent(event: EventEnvelope): void {
    if (event.type !== "run.completed") {
      return;
    }
    const data = event.data as {
      conversationId?: string;
      agentId?: string;
      runId?: string;
    };
    if (!data.conversationId || !data.agentId || !data.runId) return;
    if (this.handled.has(data.runId)) return;
    this.handled.add(data.runId);
    this.tail = this.tail
      .then(() =>
        this.maybeAutoCompact(data.conversationId!, data.agentId!, data.runId!),
      )
      .catch((error) => {
        void this.logger?.warn("automatic completion compaction failed", {
          context: { runId: data.runId },
          error,
        });
      });
  }
}
