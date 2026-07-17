import {
  publicEventDefinition,
  type EventEnvelope,
  type SkippedNonDurableRange,
} from "@nervekit/contracts";

export interface ProtocolSessionQueueStats {
  durableCount: number;
  transientCount: number;
  queuedBytes: number;
  droppedTransientCount: number;
  coalescedTransientCount: number;
  latestQueuedDurableSeq: number;
}

export interface ShiftedLiveEvents {
  events: EventEnvelope[];
  skippedNonDurableRanges: SkippedNonDurableRange[];
}

/** A single sequence-ordered live queue for one protocol stream. */
export class ProtocolSessionQueue {
  readonly #live: EventEnvelope[] = [];
  readonly #skipped: SkippedNonDurableRange[] = [];
  #queuedBytes = 0;
  #droppedTransientCount = 0;
  #coalescedTransientCount = 0;
  #latestQueuedDurableSeq = 0;

  enqueueLive(event: EventEnvelope): void {
    const previous = this.#live.at(-1);
    if (previous && event.seq <= previous.seq)
      throw new Error("Live stream events must be enqueued in ascending order");
    this.#live.push(event);
    if (event.durability === "durable")
      this.#latestQueuedDurableSeq = Math.max(
        this.#latestQueuedDurableSeq,
        event.seq,
      );
    this.#queuedBytes += estimatedBytes(event);
  }

  coalesceTransientOverflow(maxTransient: number): number {
    if (this.#transientCount() <= maxTransient) return 0;
    const output: EventEnvelope[] = [];
    const latestIndexByKey = new Map<string, number>();
    const removed: number[] = [];

    for (const event of this.#live) {
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
            removed.push(previous.seq);
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
        removed.push((output[existingIndex] as EventEnvelope).seq);
        output[existingIndex] = event;
      }
    }

    if (removed.length === 0) return 0;
    output.sort((left, right) => left.seq - right.seq);
    this.#live.splice(0, this.#live.length, ...output);
    this.#coalescedTransientCount += removed.length;
    this.#recordSkipped(removed, "coalesced");
    this.#queuedBytes = estimatedQueueBytes(this.#live);
    return removed.length;
  }

  dropTransientOverflow(maxTransient: number): number {
    const dropCount = this.#transientCount() - maxTransient;
    if (dropCount <= 0) return 0;
    let remaining = dropCount;
    const dropped: number[] = [];
    const retained = this.#live.filter((event) => {
      if (remaining > 0 && event.durability === "transient") {
        remaining -= 1;
        dropped.push(event.seq);
        return false;
      }
      return true;
    });
    this.#live.splice(0, this.#live.length, ...retained);
    this.#droppedTransientCount += dropped.length;
    this.#recordSkipped(dropped, "transient_dropped");
    this.#queuedBytes = estimatedQueueBytes(this.#live);
    return dropped.length;
  }

  shiftLive(maxEvents: number): ShiftedLiveEvents {
    const events = this.#live.splice(0, maxEvents);
    if (events.length === 0) return { events, skippedNonDurableRanges: [] };
    this.#queuedBytes = Math.max(
      0,
      this.#queuedBytes - estimatedQueueBytes(events),
    );
    this.#latestQueuedDurableSeq = Math.max(
      0,
      ...this.#live
        .filter((event) => event.durability === "durable")
        .map((event) => event.seq),
    );
    const throughSeq = (events.at(-1) as EventEnvelope).seq;
    const split = this.#skipped.findIndex(
      (range) => range.fromSeq > throughSeq,
    );
    const count = split < 0 ? this.#skipped.length : split;
    return {
      events,
      skippedNonDurableRanges: this.#skipped.splice(0, count),
    };
  }

  stats(): ProtocolSessionQueueStats {
    return {
      durableCount: this.#live.length - this.#transientCount(),
      transientCount: this.#transientCount(),
      queuedBytes: this.#queuedBytes,
      droppedTransientCount: this.#droppedTransientCount,
      coalescedTransientCount: this.#coalescedTransientCount,
      latestQueuedDurableSeq: this.#latestQueuedDurableSeq,
    };
  }

  clear(): void {
    this.#live.length = 0;
    this.#skipped.length = 0;
    this.#queuedBytes = 0;
    this.#droppedTransientCount = 0;
    this.#coalescedTransientCount = 0;
    this.#latestQueuedDurableSeq = 0;
  }

  #transientCount(): number {
    return this.#live.reduce(
      (count, event) => count + (event.durability === "transient" ? 1 : 0),
      0,
    );
  }

  #recordSkipped(
    sequences: readonly number[],
    reason: SkippedNonDurableRange["reason"],
  ): void {
    for (const seq of [...sequences].sort((left, right) => left - right)) {
      const previous = this.#skipped.at(-1);
      if (previous && previous.reason === reason && previous.toSeq + 1 === seq)
        previous.toSeq = seq;
      else this.#skipped.push({ fromSeq: seq, toSeq: seq, reason });
    }
    this.#skipped.sort((left, right) => left.fromSeq - right.fromSeq);
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
  )
    return undefined;
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

function estimatedQueueBytes(events: readonly EventEnvelope[]): number {
  return events.reduce((total, event) => total + estimatedBytes(event), 0);
}

function estimatedBytes(value: unknown): number {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).byteLength;
  } catch {
    return 512;
  }
}
