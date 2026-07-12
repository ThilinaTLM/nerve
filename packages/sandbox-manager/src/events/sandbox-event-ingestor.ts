import {
  parsePublicEventEnvelope,
  publicEventDefinition,
} from "@nervekit/contracts";
import type {
  SandboxEventStore,
  StoredSandboxEvent,
} from "../state/event-store.js";
import type { ManagerEventBus } from "./manager-event-bus.js";
import { redactManagerEvent } from "./redaction.js";
import type { SandboxActivityTracker } from "./sandbox-activity-tracker.js";

export class SandboxEventIngestor {
  private readonly queues = new Map<string, Promise<unknown>>();

  constructor(
    private readonly store: SandboxEventStore,
    private readonly bus?: ManagerEventBus,
    private readonly activity?: SandboxActivityTracker,
  ) {}

  async ingestBatch(
    sandboxId: string,
    previousDurableSeq: number,
    events: Array<{
      id?: string;
      seq?: number;
      type: string;
      ts?: string;
      durability?: "durable" | "transient";
      [key: string]: unknown;
    }>,
  ): Promise<{ processedSeq: number; accepted: number }> {
    return this.withSandboxQueue(sandboxId, async () => {
      const existing = await this.store.list(sandboxId);
      const durableExisting = existing
        .filter((event) => event.durability !== "transient")
        .sort((left, right) => (left.seq ?? 0) - (right.seq ?? 0));
      let processedSeq = durableExisting.at(-1)?.seq ?? 0;
      if (previousDurableSeq > processedSeq)
        throw new Error(
          "Agent durable predecessor is ahead of manager storage",
        );
      let provenReplaySeq = previousDurableSeq;
      let accepted = 0;

      for (const raw of events) {
        const envelope = parseSandboxEnvelope(sandboxId, raw);
        const stored: StoredSandboxEvent = {
          sandboxId,
          id: envelope.id,
          seq: envelope.seq,
          type: envelope.type,
          ts: envelope.ts,
          durability: envelope.durability,
          payload: envelope.data,
        };

        if (envelope.durability === "durable") {
          const duplicate = durableExisting.find(
            (item) => item.seq === envelope.seq || item.id === envelope.id,
          );
          if (duplicate) {
            assertSameDurableEvent(duplicate, stored);
            if (envelope.seq > provenReplaySeq) provenReplaySeq = envelope.seq;
            continue;
          }
          if (provenReplaySeq !== processedSeq)
            throw new Error(
              "Sandbox durable replay does not reach manager cursor",
            );
          if (envelope.seq <= processedSeq)
            throw new Error("Sandbox durable event sequence regressed");
          if (!(await this.store.append(stored)))
            throw new Error("Sandbox durable event was not persisted");
          processedSeq = envelope.seq;
          provenReplaySeq = envelope.seq;
          durableExisting.push(stored);
        }

        accepted += 1;
        this.publish(sandboxId, stored);
      }
      return { processedSeq, accepted };
    });
  }

  private publish(sandboxId: string, stored: StoredSandboxEvent): void {
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

  private async withSandboxQueue<T>(
    sandboxId: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const previous = this.queues.get(sandboxId) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(operation);
    this.queues.set(sandboxId, next);
    try {
      return await next;
    } finally {
      if (this.queues.get(sandboxId) === next) this.queues.delete(sandboxId);
    }
  }
}

function parseSandboxEnvelope(
  sandboxId: string,
  event: {
    id?: string;
    seq?: number;
    type: string;
    ts?: string;
    durability?: "durable" | "transient";
    [key: string]: unknown;
  },
) {
  const definition = publicEventDefinition(event.type);
  if (!definition) throw new Error(`Unknown public event: ${event.type}`);
  const durability = event.durability ?? definition.durability;
  if (durability !== definition.durability)
    throw new Error(`Event ${event.type} must use ${definition.durability}`);
  return parsePublicEventEnvelope(
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
}

function assertSameDurableEvent(
  existing: StoredSandboxEvent,
  candidate: StoredSandboxEvent,
): void {
  if (
    existing.seq !== candidate.seq ||
    existing.id !== candidate.id ||
    existing.type !== candidate.type ||
    JSON.stringify(existing.payload) !== JSON.stringify(candidate.payload)
  )
    throw new Error("Conflicting durable sandbox event replay");
}
