import {
  type EventBatchData,
  type EventEnvelope,
  eventBatchDataSchema,
} from "@nervekit/contracts";

export interface ClientEventStreamState {
  processedSeq: number;
  continuitySeq: number;
  highestReceivedSeq: number;
  replayBlocked: boolean;
}

export interface EventBatchResult {
  appliedEvents: number;
  duplicateEvents: number;
  durableEventsQueued: number;
  highestDurableQueuedSeq: number;
  highestReceivedSeq: number;
  replayRequired?: {
    fromSeq: number;
    reason: "gap_detected";
  };
}

export function createClientEventStreamState(
  processedSeq = 0,
): ClientEventStreamState {
  return {
    processedSeq,
    continuitySeq: processedSeq,
    highestReceivedSeq: processedSeq,
    replayBlocked: false,
  };
}

export function processedSeqFromCursor(
  cursor: { streams: Array<{ stream: string; processedSeq: number }> },
  streamName = "local",
): number {
  return (
    cursor.streams.find((stream) => stream.stream === streamName)
      ?.processedSeq ?? 0
  );
}

export const globalProcessedSeqFromCursor = processedSeqFromCursor;

export function resetClientEventStreamStateFromCursor(
  state: ClientEventStreamState,
  cursor: { streams: Array<{ stream: string; processedSeq: number }> },
  streamName = "local",
): number {
  const processedSeq = processedSeqFromCursor(cursor, streamName);
  resetClientEventStreamState(state, processedSeq);
  return processedSeq;
}

export function resetClientEventStreamState(
  state: ClientEventStreamState,
  processedSeq: number,
): void {
  state.processedSeq = processedSeq;
  state.continuitySeq = processedSeq;
  state.highestReceivedSeq = Math.max(state.highestReceivedSeq, processedSeq);
  state.replayBlocked = false;
}

export function applyEventBatch(
  raw: unknown,
  state: ClientEventStreamState,
  enqueue: (event: EventEnvelope<Record<string, unknown>>) => void,
  streamName = "local",
): EventBatchResult {
  const batch = eventBatchDataSchema.parse(raw) as EventBatchData;
  if (batch.stream !== streamName) {
    state.replayBlocked = true;
    return replayRequired(state);
  }

  const durableEvents = batch.events.filter(
    (event) => event.durability === "durable",
  );
  const firstNonDuplicateDurable = durableEvents.find(
    (event) => event.seq > state.processedSeq,
  );
  if (firstNonDuplicateDurable) {
    const previousDurableSeq = batch.range.previousDurableSeq;
    if (previousDurableSeq === undefined || previousDurableSeq === null) {
      state.replayBlocked = true;
      return replayRequired(state);
    }
    if (previousDurableSeq > state.continuitySeq) {
      state.replayBlocked = true;
      return replayRequired(state);
    }
  }

  if (state.replayBlocked) return replayRequired(state);

  let appliedEvents = 0;
  let duplicateEvents = 0;
  let durableEventsQueued = 0;
  let highestDurableQueuedSeq = state.continuitySeq;

  for (const event of batch.events) {
    state.highestReceivedSeq = Math.max(state.highestReceivedSeq, event.seq);
    if (event.durability === "durable" && event.seq <= state.processedSeq) {
      duplicateEvents += 1;
      continue;
    }
    enqueue(event as EventEnvelope<Record<string, unknown>>);
    appliedEvents += 1;
    if (event.durability === "durable") {
      durableEventsQueued += 1;
      highestDurableQueuedSeq = Math.max(highestDurableQueuedSeq, event.seq);
    }
  }

  if (durableEventsQueued > 0) {
    state.continuitySeq = highestDurableQueuedSeq;
  }

  return {
    appliedEvents,
    duplicateEvents,
    durableEventsQueued,
    highestDurableQueuedSeq,
    highestReceivedSeq: state.highestReceivedSeq,
  };
}

export function markProcessed(
  state: ClientEventStreamState,
  processedSeq: number,
): void {
  state.processedSeq = Math.max(state.processedSeq, processedSeq);
  state.continuitySeq = Math.max(state.continuitySeq, state.processedSeq);
}

function replayRequired(state: ClientEventStreamState): EventBatchResult {
  return {
    appliedEvents: 0,
    duplicateEvents: 0,
    durableEventsQueued: 0,
    highestDurableQueuedSeq: state.processedSeq,
    highestReceivedSeq: state.highestReceivedSeq,
    replayRequired: { fromSeq: state.processedSeq, reason: "gap_detected" },
  };
}
