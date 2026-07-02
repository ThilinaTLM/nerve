import type { EventStore } from "../state/event-store.js";
import { redactManagerEvent } from "./redaction.js";
export class SandboxEventIngestor {
  constructor(private readonly store: EventStore) {}
  async ingestBatch(
    sandboxId: string,
    events: Array<{
      id?: string;
      seq?: number;
      type: string;
      ts?: string;
      [key: string]: unknown;
    }>,
  ): Promise<{ processedSeq: number; accepted: number }> {
    let processedSeq = 0;
    let accepted = 0;
    for (const event of events) {
      processedSeq = Math.max(processedSeq, event.seq ?? 0);
      if (
        await this.store.append({
          sandboxId,
          id: event.id,
          seq: event.seq,
          type: event.type,
          ts: event.ts,
          payload: redactManagerEvent(event),
        })
      )
        accepted += 1;
    }
    return { processedSeq, accepted };
  }
}
