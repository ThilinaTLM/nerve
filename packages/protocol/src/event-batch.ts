import {
  type EventBatchData,
  type EventBatchReason,
  type EventEnvelope,
  eventBatchDataSchema,
} from "@nervekit/contracts";

export interface BuildEventBatchOptions {
  stream: string;
  reason: EventBatchReason;
  previousDurableSeq?: number;
  replay?: EventBatchData["replay"];
}

export function buildEventBatch(
  events: EventEnvelope[],
  options: BuildEventBatchOptions,
): EventBatchData {
  const sorted = [...events].sort((a, b) => a.seq - b.seq);
  const durable = sorted.filter((event) => event.durability === "durable");
  const transient = sorted.filter((event) => event.durability === "transient");
  const range: EventBatchData["range"] = {
    firstSeq: sorted[0]?.seq ?? null,
    lastSeq: sorted.at(-1)?.seq ?? null,
    durableCount: durable.length,
    transientCount: transient.length,
  };

  if (durable.length > 0) {
    const firstDurable = durable[0] as EventEnvelope;
    const lastDurable = durable.at(-1) as EventEnvelope;
    range.durableFirstSeq = firstDurable.seq;
    range.durableLastSeq = lastDurable.seq;
    range.previousDurableSeq = options.previousDurableSeq ?? 0;
    range.durableCompleteThroughSeq = lastDurable.seq;
  }

  const data: EventBatchData = {
    stream: options.stream,
    batchId: globalThis.crypto.randomUUID(),
    reason: options.reason,
    events: sorted,
    range,
    replay: options.replay,
  };

  return eventBatchDataSchema.parse(data) as EventBatchData;
}

export function estimateProtocolMessageBytes(
  kind: string,
  data: unknown,
): number {
  return encodedBytes({ kind, data });
}

export function chunkEvents(
  events: EventEnvelope[],
  maxEvents: number,
  maxBytes = Number.POSITIVE_INFINITY,
): EventEnvelope[][] {
  const chunks: EventEnvelope[][] = [];
  let current: EventEnvelope[] = [];
  let currentBytes = 0;
  for (const event of events) {
    const eventBytes = encodedBytes(event);
    const wouldExceedCount = current.length >= maxEvents;
    const wouldExceedBytes =
      current.length > 0 && currentBytes + eventBytes > maxBytes;
    if (wouldExceedCount || wouldExceedBytes) {
      chunks.push(current);
      current = [];
      currentBytes = 0;
    }
    current.push(event);
    currentBytes += eventBytes;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

function encodedBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}
