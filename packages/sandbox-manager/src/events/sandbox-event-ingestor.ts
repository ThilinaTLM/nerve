import {
  parsePublicEventEnvelope,
  publicEventDefinition,
} from "@nervekit/contracts";
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
      const definition = publicEventDefinition(event.type);
      if (!definition) throw new Error(`Unknown public event: ${event.type}`);
      const durability = event.durability ?? definition.durability;
      if (durability !== definition.durability) {
        throw new Error(
          `Event ${event.type} must use ${definition.durability}`,
        );
      }
      const envelope = parsePublicEventEnvelope(
        {
          id: event.id ?? `evt_${sandboxId}_${event.seq ?? 0}`,
          seq: event.seq ?? 1,
          type: event.type,
          ts: event.ts ?? new Date().toISOString(),
          durability,
          data: redactManagerEvent(event.data ?? event),
        },
        "sandbox_agent",
      );
      if (envelope.durability === "durable") {
        processedSeq = Math.max(processedSeq, envelope.seq);
      }
      const stored = {
        sandboxId,
        id: envelope.id,
        seq: envelope.seq,
        type: envelope.type,
        ts: envelope.ts,
        durability: envelope.durability,
        payload: envelope.data,
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
