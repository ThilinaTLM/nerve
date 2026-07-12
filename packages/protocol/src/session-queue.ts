import { publicEventDefinition, type EventEnvelope } from "@nervekit/contracts";

export interface ProtocolSessionQueueStats {
  durableCount: number;
  transientCount: number;
  queuedBytes: number;
  droppedTransientCount: number;
  coalescedTransientCount: number;
  latestQueuedDurableSeq: number;
}

export class ProtocolSessionQueue {
  readonly durable: EventEnvelope[] = [];
  readonly transient: EventEnvelope[] = [];
  #queuedBytes = 0;
  #droppedTransientCount = 0;
  #coalescedTransientCount = 0;
  #latestQueuedDurableSeq = 0;

  enqueueLive(event: EventEnvelope): void {
    if (event.durability === "durable") {
      this.durable.push(event);
      this.#latestQueuedDurableSeq = Math.max(
        this.#latestQueuedDurableSeq,
        event.seq,
      );
    } else {
      this.transient.push(event);
    }
    this.#queuedBytes += estimatedBytes(event);
  }

  coalesceTransientOverflow(maxTransient: number): number {
    if (this.transient.length <= maxTransient) return 0;
    const originalLength = this.transient.length;
    const output: EventEnvelope[] = [];
    const latestIndexByKey = new Map<string, number>();

    for (const event of this.transient) {
      const strategy = coalescingStrategy(event);
      if (!strategy) {
        output.push(event);
        continue;
      }

      if (strategy.mode === "concat_delta") {
        const previous = output.at(-1);
        if (previous && coalescingStrategy(previous)?.key === strategy.key) {
          const merged = mergeDeltaEvents(previous, event);
          if (merged) {
            output[output.length - 1] = merged;
            continue;
          }
        }
        output.push(event);
        continue;
      }

      const existingIndex = latestIndexByKey.get(strategy.key);
      if (existingIndex === undefined) {
        latestIndexByKey.set(strategy.key, output.length);
        output.push(event);
      } else {
        output[existingIndex] = event;
      }
    }

    const coalesced = originalLength - output.length;
    if (coalesced <= 0) return 0;
    this.transient.splice(0, this.transient.length, ...output);
    this.#coalescedTransientCount += coalesced;
    this.#queuedBytes = estimatedQueueBytes(this.durable, this.transient);
    return coalesced;
  }

  dropTransientOverflow(maxTransient: number): void {
    if (this.transient.length <= maxTransient) return;
    const dropCount = this.transient.length - maxTransient;
    this.transient.splice(0, dropCount);
    this.#droppedTransientCount += dropCount;
    this.#queuedBytes = estimatedQueueBytes(this.durable, this.transient);
  }

  dropTransientThrough(seq: number): number {
    const retained = this.transient.filter((event) => event.seq > seq);
    const dropped = this.transient.length - retained.length;
    if (dropped === 0) return 0;
    this.transient.splice(0, this.transient.length, ...retained);
    this.#droppedTransientCount += dropped;
    this.#queuedBytes = estimatedQueueBytes(this.durable, this.transient);
    return dropped;
  }

  shiftDurable(maxEvents: number): EventEnvelope[] {
    const events = this.durable.splice(0, maxEvents);
    if (events.length > 0) {
      this.#queuedBytes = Math.max(
        0,
        this.#queuedBytes - estimatedBytes(events),
      );
    }
    return events;
  }

  shiftTransient(maxEvents: number): EventEnvelope[] {
    const events = this.transient.splice(0, maxEvents);
    if (events.length > 0) {
      this.#queuedBytes = Math.max(
        0,
        this.#queuedBytes - estimatedBytes(events),
      );
    }
    return events;
  }

  stats(): ProtocolSessionQueueStats {
    return {
      durableCount: this.durable.length,
      transientCount: this.transient.length,
      queuedBytes: this.#queuedBytes,
      droppedTransientCount: this.#droppedTransientCount,
      coalescedTransientCount: this.#coalescedTransientCount,
      latestQueuedDurableSeq: this.#latestQueuedDurableSeq,
    };
  }

  clear(): void {
    this.durable.length = 0;
    this.transient.length = 0;
    this.#queuedBytes = 0;
    this.#droppedTransientCount = 0;
    this.#coalescedTransientCount = 0;
    this.#latestQueuedDurableSeq = 0;
  }
}

type TransientCoalescingStrategy = {
  key: string;
  mode: "latest" | "concat_delta";
};

function coalescingStrategy(
  event: EventEnvelope,
): TransientCoalescingStrategy | undefined {
  if (event.durability !== "transient") return undefined;
  const data = event.data;
  if (!isRecord(data)) return undefined;
  const definition = publicEventDefinition(event.type);
  if (!definition?.coalescing) return undefined;
  const key = eventKey(data, definition.scope);
  if (!key) return undefined;
  return {
    key: `${event.type}:${key}`,
    mode: definition.coalescing === "concat_delta" ? "concat_delta" : "latest",
  };
}

function mergeDeltaEvents(
  previous: EventEnvelope,
  next: EventEnvelope,
): EventEnvelope | undefined {
  if (!isRecord(previous.data) || !isRecord(next.data)) return undefined;
  const previousDelta = stringField(previous.data, "delta");
  const nextDelta = stringField(next.data, "delta");
  if (previousDelta === undefined || nextDelta === undefined) return undefined;
  const previousOffset = numberField(previous.data, "offset");
  const nextOffset = numberField(next.data, "offset");
  if (
    previousOffset !== undefined &&
    nextOffset !== undefined &&
    previousOffset + previousDelta.length !== nextOffset
  ) {
    return undefined;
  }
  return {
    ...next,
    data: {
      ...next.data,
      offset: previousOffset ?? nextOffset,
      delta: `${previousDelta}${nextDelta}`,
    },
  };
}

function eventKey(
  data: Record<string, unknown>,
  fields: readonly string[],
): string | undefined {
  const parts = fields
    .map((field) => valueAtPath(data, field))
    .filter((value) => value !== undefined && value !== null)
    .map(String);
  return parts.length > 0 ? parts.join(":") : undefined;
}

function stringField(
  data: Record<string, unknown> | undefined,
  field: string,
): string | undefined {
  const value = data?.[field];
  return typeof value === "string" ? value : undefined;
}

function numberField(
  data: Record<string, unknown>,
  field: string,
): number | undefined {
  const value = data[field];
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function valueAtPath(data: Record<string, unknown>, path: string): unknown {
  let value: unknown = data;
  for (const segment of path.split(".")) {
    if (!isRecord(value)) return undefined;
    value = value[segment];
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function estimatedQueueBytes(
  durable: EventEnvelope[],
  transient: EventEnvelope[],
): number {
  return (
    durable.reduce((sum, value) => sum + estimatedBytes(value), 0) +
    transient.reduce((sum, value) => sum + estimatedBytes(value), 0)
  );
}

function estimatedBytes(value: unknown): number {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).byteLength;
  } catch {
    return 512;
  }
}
