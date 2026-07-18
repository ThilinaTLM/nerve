import {
  type EventBatchData,
  type EventEnvelope,
  WORKSPACE_STREAM,
  eventBatchDataSchema,
} from "@nervekit/contracts";

export interface ClientEventStreamState {
  processedSeq: number;
}

export interface EventBatchResult {
  appliedEvents: number;
  duplicateEvents: number;
  highestReceivedSeq: number;
  gap?: { expectedSeq: number; receivedSeq: number };
}

export function createClientEventStreamState(
  processedSeq = 0,
): ClientEventStreamState {
  return { processedSeq };
}

export function processedSeqFromCursor(
  cursor: { streams: Array<{ stream: string; processedSeq: number }> },
  streamName = WORKSPACE_STREAM,
): number {
  return (
    cursor.streams.find((stream) => stream.stream === streamName)
      ?.processedSeq ?? 0
  );
}

export function resetClientEventStreamStateFromCursor(
  state: ClientEventStreamState,
  cursor: { streams: Array<{ stream: string; processedSeq: number }> },
  streamName = WORKSPACE_STREAM,
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
}

/**
 * Filters duplicates and verifies dense continuity. Cursor advancement remains
 * explicit so callers can apply reducers before committing progress.
 */
export function applyEventBatch(
  raw: unknown,
  state: ClientEventStreamState,
  enqueue: (event: EventEnvelope<Record<string, unknown>>) => void,
  streamName = WORKSPACE_STREAM,
): EventBatchResult {
  const batch = eventBatchDataSchema.parse(raw) as EventBatchData;
  if (batch.stream !== streamName) {
    throw new Error(`Received ${batch.stream} batch for ${streamName}`);
  }

  let expectedSeq = state.processedSeq + 1;
  let duplicateEvents = 0;
  let appliedEvents = 0;
  for (const event of batch.events) {
    if (event.seq <= state.processedSeq) {
      duplicateEvents += 1;
      continue;
    }
    if (event.seq !== expectedSeq) {
      return {
        appliedEvents: 0,
        duplicateEvents,
        highestReceivedSeq: batch.lastSeq ?? state.processedSeq,
        gap: { expectedSeq, receivedSeq: event.seq },
      };
    }
    enqueue(event as EventEnvelope<Record<string, unknown>>);
    appliedEvents += 1;
    expectedSeq += 1;
  }

  return {
    appliedEvents,
    duplicateEvents,
    highestReceivedSeq: batch.lastSeq ?? state.processedSeq,
  };
}

export function markProcessed(
  state: ClientEventStreamState,
  processedSeq: number,
): void {
  if (processedSeq <= state.processedSeq) return;
  if (processedSeq !== state.processedSeq + 1) {
    throw new Error(
      `Cannot advance stream cursor from ${state.processedSeq} to ${processedSeq}`,
    );
  }
  state.processedSeq = processedSeq;
}
