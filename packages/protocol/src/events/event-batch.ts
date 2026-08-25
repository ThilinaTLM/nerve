import {
  type EventBatchData,
  type EventBatchReason,
  type EventEnvelope,
  eventBatchDataSchema,
} from "@nervekit/contracts";

export interface BuildEventBatchOptions {
  stream: string;
  reason: EventBatchReason;
  batchId?: string;
}

export function buildEventBatch(
  events: readonly EventEnvelope[],
  options: BuildEventBatchOptions,
): EventBatchData {
  const ordered = [...events];
  const data: EventBatchData = {
    stream: options.stream,
    batchId: options.batchId ?? `batch_${globalThis.crypto.randomUUID()}`,
    reason: options.reason,
    events: ordered,
    firstSeq: ordered[0]?.seq ?? null,
    lastSeq: ordered.at(-1)?.seq ?? null,
  };
  return eventBatchDataSchema.parse(data) as EventBatchData;
}

export function estimateProtocolMessageBytes(
  kind: string,
  data: unknown,
): number {
  return encodedBytes({ kind, data });
}

/** Splits on limits and on any defensive discontinuity in the input. */
export function chunkEvents(
  events: readonly EventEnvelope[],
  maxEvents: number,
  maxBytes = Number.POSITIVE_INFINITY,
): EventEnvelope[][] {
  const chunks: EventEnvelope[][] = [];
  let current: EventEnvelope[] = [];
  let currentBytes = 0;
  for (const event of events) {
    const eventBytes = encodedBytes(event);
    const previous = current.at(-1);
    const discontinuity =
      previous !== undefined && event.seq !== previous.seq + 1;
    const wouldExceedCount = current.length >= maxEvents;
    const wouldExceedBytes =
      current.length > 0 && currentBytes + eventBytes > maxBytes;
    if (discontinuity || wouldExceedCount || wouldExceedBytes) {
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
