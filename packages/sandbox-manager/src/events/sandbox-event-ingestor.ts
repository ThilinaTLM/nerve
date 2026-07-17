import {
  parsePublicEventEnvelope,
  publicEventDefinition,
  type EventEnvelope,
  type StructuredLogger,
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
    private readonly logger?: StructuredLogger,
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
  ): Promise<{
    processedSeq: number;
    accepted: number;
    acceptedEvents: StoredSandboxEvent[];
  }> {
    return this.withSandboxQueue(sandboxId, async () => {
      const startedAt = Date.now();
      const parsed = events.map((raw) => parseSandboxEnvelope(sandboxId, raw));
      for (let index = 1; index < parsed.length; index += 1) {
        if ((parsed[index]?.seq ?? 0) <= (parsed[index - 1]?.seq ?? 0))
          throw new Error(
            "Sandbox event batch must be in ascending sequence order",
          );
      }
      const candidates = parsed.map((envelope) =>
        toStored(sandboxId, envelope),
      );
      const durableCandidates = candidates.filter(
        (event) => event.durability === "durable",
      );
      const [streamState, conflicts] = await Promise.all([
        this.store.streamState(sandboxId),
        this.store.findDurableConflicts(sandboxId, durableCandidates),
      ]);
      let processedSeq = streamState.durableSeq;
      if (previousDurableSeq > processedSeq)
        throw new Error(
          "Agent durable predecessor is ahead of manager storage",
        );

      const conflictById = new Map(
        conflicts.flatMap((event) =>
          event.id ? [[event.id, event] as const] : [],
        ),
      );
      const conflictBySeq = new Map(
        conflicts.flatMap((event) =>
          event.seq === undefined ? [] : ([[event.seq, event]] as const),
        ),
      );
      let provenReplaySeq = previousDurableSeq;
      const acceptedEvents: StoredSandboxEvent[] = [];
      const durableToInsert: StoredSandboxEvent[] = [];

      for (const stored of candidates) {
        if (stored.durability === "durable") {
          const duplicate =
            (stored.id ? conflictById.get(stored.id) : undefined) ??
            (stored.seq === undefined
              ? undefined
              : conflictBySeq.get(stored.seq));
          if (duplicate) {
            assertSameDurableEvent(duplicate, stored);
            provenReplaySeq = Math.max(provenReplaySeq, stored.seq ?? 0);
            continue;
          }
          if (provenReplaySeq !== processedSeq)
            throw new Error(
              "Sandbox durable replay does not reach manager cursor",
            );
          if ((stored.seq ?? 0) <= processedSeq)
            throw new Error("Sandbox durable event sequence regressed");
          durableToInsert.push(stored);
          processedSeq = stored.seq as number;
          provenReplaySeq = processedSeq;
        }
        acceptedEvents.push(stored);
      }

      // One atomic database statement: no event becomes visible until the
      // complete durable portion of this batch commits.
      await this.store.appendDurableBatch(durableToInsert);
      for (const stored of acceptedEvents) this.publish(sandboxId, stored);
      this.logger?.debug("Sandbox event batch ingested", {
        sandboxId,
        durationMs: Date.now() - startedAt,
        acceptedDurable: durableToInsert.length,
        acceptedTransient: acceptedEvents.length - durableToInsert.length,
        processedSeq,
      });
      return {
        processedSeq,
        accepted: acceptedEvents.length,
        acceptedEvents,
      };
    });
  }

  private publish(sandboxId: string, stored: StoredSandboxEvent): void {
    if (
      !stored.id ||
      stored.seq === undefined ||
      !stored.ts ||
      !stored.durability ||
      !isRecord(stored.payload)
    )
      throw new Error("Manager event publication requires a complete envelope");
    this.bus?.publish({
      type: stored.type,
      stream: `sandbox:${sandboxId}`,
      sandboxId,
      seq: stored.seq,
      id: stored.id,
      durability: stored.durability,
      payload: stored.payload,
      ts: stored.ts,
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
): EventEnvelope<Record<string, unknown>> {
  const definition = publicEventDefinition(event.type);
  if (!definition) throw new Error(`Unknown public event: ${event.type}`);
  if (!event.id || !event.seq)
    throw new Error("Sandbox events require an id and positive sequence");
  const durability = event.durability ?? definition.durability;
  if (durability !== definition.durability)
    throw new Error(`Event ${event.type} must use ${definition.durability}`);
  return parsePublicEventEnvelope(
    {
      id: event.id,
      seq: event.seq,
      type: event.type,
      ts: event.ts ?? new Date().toISOString(),
      durability,
      data: redactManagerEvent(event.data ?? event),
    },
    "sandbox_agent",
  ) as EventEnvelope<Record<string, unknown>>;
}

function toStored(
  sandboxId: string,
  envelope: EventEnvelope<Record<string, unknown>>,
): StoredSandboxEvent {
  return {
    sandboxId,
    id: envelope.id,
    seq: envelope.seq,
    type: envelope.type,
    ts: envelope.ts,
    durability: envelope.durability,
    payload: envelope.data,
  };
}

function assertSameDurableEvent(
  existing: StoredSandboxEvent,
  candidate: StoredSandboxEvent,
): void {
  if (
    existing.seq !== candidate.seq ||
    existing.id !== candidate.id ||
    existing.type !== candidate.type ||
    canonicalJson(existing.payload) !== canonicalJson(candidate.payload)
  )
    throw new Error("Conflicting durable sandbox event replay");
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeysDeep(value));
}

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, entry]) => [key, sortKeysDeep(entry)]),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
