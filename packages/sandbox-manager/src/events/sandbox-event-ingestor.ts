import type { SandboxEventStore } from "../state/event-store.js";
import type { ManagerEventBus } from "./manager-event-bus.js";
import { redactManagerEvent } from "./redaction.js";
import type { SandboxActivityTracker } from "./sandbox-activity-tracker.js";
export class SandboxEventIngestor {
  constructor(
    private readonly store: SandboxEventStore,
    private readonly bus?: ManagerEventBus,
    private readonly activity?: SandboxActivityTracker,
  ) {}
  async ingestBatch(
    sandboxId: string,
    events: Array<{
      id?: string;
      seq?: number;
      type: string;
      ts?: string;
      durability?: "durable" | "transient";
      [key: string]: unknown;
    }>,
  ): Promise<{ processedSeq: number; accepted: number }> {
    let processedSeq = 0;
    let accepted = 0;
    for (const event of events) {
      const durability =
        event.durability ??
        (event.type === "run.delta" ? "transient" : ("durable" as const));
      if (durability === "durable") {
        processedSeq = Math.max(processedSeq, event.seq ?? 0);
      }
      const stored = {
        sandboxId,
        id: event.id,
        seq: event.seq,
        type: event.type,
        ts: event.ts,
        durability,
        payload: redactManagerEvent(event.data ?? event),
      };
      if (await this.store.append(stored)) {
        accepted += 1;
        this.bus?.publish({
          type: stored.type,
          stream: `sandbox:${sandboxId}`,
          sandboxId,
          seq: stored.seq,
          id: stored.id,
          durability: stored.durability,
          payload: stored.payload,
          ts: stored.ts ?? new Date().toISOString(),
        });
        this.activity?.observe(sandboxId, {
          type: stored.type,
          ts: stored.ts,
          payload: stored.payload,
        });
      }
    }
    return { processedSeq, accepted };
  }
}
