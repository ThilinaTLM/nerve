import {
  notifyEventSchema,
  parsePublicEventEnvelope,
  publicEventDefinition,
  validatePublicEvent,
  type EventEnvelope,
  type NotifyEvent,
  type StructuredLogger,
} from "@nervekit/contracts";
import type {
  SandboxEpochResetResult,
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

  async establishAgentEpoch(
    sandboxId: string,
    agentLatestSeq: number,
  ): Promise<SandboxEpochResetResult> {
    return this.withSandboxQueue(sandboxId, async () => {
      const result = await this.store.archiveEpochIfAhead(
        sandboxId,
        agentLatestSeq,
      );
      if (result.reset) {
        this.logger?.warn("Sandbox agent event epoch reset", {
          sandboxId,
          previousLatestSeq: result.previousLatestSeq,
          agentLatestSeq,
        });
      }
      return result;
    });
  }

  async ingestBatch(
    sandboxId: string,
    events: readonly EventEnvelope[],
  ): Promise<{
    processedSeq: number;
    accepted: number;
    acceptedEvents: StoredSandboxEvent[];
  }> {
    return this.withSandboxQueue(sandboxId, async () => {
      const startedAt = Date.now();
      const parsed = events.map((raw) => parseSandboxEnvelope(raw));
      for (let index = 1; index < parsed.length; index += 1) {
        if (parsed[index]?.seq !== (parsed[index - 1]?.seq ?? 0) + 1)
          throw new Error(
            "Sandbox event batch must use consecutive sequence numbers",
          );
      }

      const candidates = parsed.map((envelope) =>
        toStored(sandboxId, envelope),
      );
      const [streamState, conflicts] = await Promise.all([
        this.store.streamState(sandboxId),
        this.store.findConflicts(sandboxId, candidates),
      ]);
      const conflictById = new Map(conflicts.map((event) => [event.id, event]));
      const conflictBySeq = new Map(
        conflicts.map((event) => [event.seq, event]),
      );
      let processedSeq = streamState.latestSeq;
      const acceptedEvents: StoredSandboxEvent[] = [];

      for (const candidate of candidates) {
        if (candidate.seq <= processedSeq) {
          const duplicate =
            conflictById.get(candidate.id) ?? conflictBySeq.get(candidate.seq);
          if (!duplicate) throw new Error("Sandbox event sequence regressed");
          assertSameEvent(duplicate, candidate);
          continue;
        }
        if (candidate.seq !== processedSeq + 1)
          throw new Error(
            `Sandbox event gap: expected ${processedSeq + 1}, received ${candidate.seq}`,
          );
        acceptedEvents.push(candidate);
        processedSeq = candidate.seq;
      }

      // One atomic database statement: no sequenced event becomes visible until
      // the complete new suffix commits.
      await this.store.appendBatch(acceptedEvents);
      for (const stored of acceptedEvents) this.publish(sandboxId, stored);
      this.logger?.debug("Sandbox event batch ingested", {
        sandboxId,
        durationMs: Date.now() - startedAt,
        accepted: acceptedEvents.length,
        processedSeq,
      });
      return {
        processedSeq,
        accepted: acceptedEvents.length,
        acceptedEvents,
      };
    });
  }

  ingestNotify(sandboxId: string, events: readonly NotifyEvent[]): void {
    for (const raw of events) {
      const definition = publicEventDefinition(raw.type);
      if (!definition || definition.delivery !== "ephemeral")
        throw new Error(`Event ${raw.type} cannot use event.notify`);
      const event = notifyEventSchema.parse({
        ...raw,
        data: validatePublicEvent(
          raw.type,
          redactManagerEvent(raw.data),
          "sandbox_agent",
        ),
      }) as NotifyEvent<Record<string, unknown>>;
      this.bus?.notify({
        stream: `sandbox:${sandboxId}`,
        sandboxId,
        event,
      });
      this.activity?.observe(sandboxId, {
        type: event.type,
        ts: event.ts,
        payload: event.data,
      });
    }
  }

  private publish(sandboxId: string, stored: StoredSandboxEvent): void {
    if (!isRecord(stored.payload))
      throw new Error("Manager event publication requires object data");
    this.bus?.publish({
      type: stored.type,
      stream: `sandbox:${sandboxId}`,
      sandboxId,
      seq: stored.seq,
      id: stored.id,
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
  event: EventEnvelope,
): EventEnvelope<Record<string, unknown>> {
  return parsePublicEventEnvelope(
    {
      ...event,
      data: redactManagerEvent(event.data),
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
    payload: envelope.data,
  };
}

function assertSameEvent(
  existing: StoredSandboxEvent,
  candidate: StoredSandboxEvent,
): void {
  if (
    existing.seq !== candidate.seq ||
    existing.id !== candidate.id ||
    existing.type !== candidate.type ||
    existing.ts !== candidate.ts ||
    canonicalJson(existing.payload) !== canonicalJson(candidate.payload)
  )
    throw new Error("Conflicting sandbox event replay");
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
