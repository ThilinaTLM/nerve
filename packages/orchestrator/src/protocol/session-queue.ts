import type { EventEnvelope, NerveMessage } from "@nervekit/shared";

export type QueuePriority = "control" | "replay" | "durable" | "transient";

export type QueuedProtocolItem =
  | { priority: "control"; message: NerveMessage }
  | { priority: "replay"; events: EventEnvelope[]; meta?: unknown }
  | { priority: "durable"; events: EventEnvelope[]; reason: "live" | "catchup" }
  | { priority: "transient"; events: EventEnvelope[]; reason: "live" };

export interface ProtocolSessionQueueStats {
  controlCount: number;
  replayCount: number;
  durableCount: number;
  transientCount: number;
  queuedBytes: number;
  droppedTransientCount: number;
  coalescedTransientCount: number;
  latestQueuedDurableSeq: number;
}

export class ProtocolSessionQueue {
  readonly control: NerveMessage[] = [];
  readonly replay: EventEnvelope[][] = [];
  readonly durable: EventEnvelope[] = [];
  readonly transient: EventEnvelope[] = [];
  #queuedBytes = 0;
  #droppedTransientCount = 0;
  #coalescedTransientCount = 0;
  #latestQueuedDurableSeq = 0;

  enqueueControl(message: NerveMessage): void {
    this.control.push(message);
    this.#queuedBytes += estimatedBytes(message);
  }

  enqueueReplay(events: EventEnvelope[]): void {
    if (events.length === 0) return;
    this.replay.push(events);
    this.#queuedBytes += estimatedBytes(events);
    this.#latestQueuedDurableSeq = Math.max(
      this.#latestQueuedDurableSeq,
      ...events
        .filter((event) => event.durability === "durable")
        .map((event) => event.seq),
      0,
    );
  }

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
    this.#queuedBytes = estimatedQueueBytes(
      this.control,
      this.replay,
      this.durable,
      this.transient,
    );
    return coalesced;
  }

  dropTransientOverflow(maxTransient: number): void {
    if (this.transient.length <= maxTransient) return;
    const dropCount = this.transient.length - maxTransient;
    this.transient.splice(0, dropCount);
    this.#droppedTransientCount += dropCount;
    this.#queuedBytes = Math.max(0, this.#queuedBytes - dropCount * 512);
  }

  shiftControl(): NerveMessage | undefined {
    const message = this.control.shift();
    if (message)
      this.#queuedBytes = Math.max(
        0,
        this.#queuedBytes - estimatedBytes(message),
      );
    return message;
  }

  shiftReplayBatch(): EventEnvelope[] | undefined {
    const events = this.replay.shift();
    if (events)
      this.#queuedBytes = Math.max(
        0,
        this.#queuedBytes - estimatedBytes(events),
      );
    return events;
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
      controlCount: this.control.length,
      replayCount: this.replay.reduce((sum, batch) => sum + batch.length, 0),
      durableCount: this.durable.length,
      transientCount: this.transient.length,
      queuedBytes: this.#queuedBytes,
      droppedTransientCount: this.#droppedTransientCount,
      coalescedTransientCount: this.#coalescedTransientCount,
      latestQueuedDurableSeq: this.#latestQueuedDurableSeq,
    };
  }

  clear(): void {
    this.control.length = 0;
    this.replay.length = 0;
    this.durable.length = 0;
    this.transient.length = 0;
    this.#queuedBytes = 0;
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

  if (event.type === "usage.subscription.updated") {
    return {
      key: `${event.type}:${stringField(data, "provider") ?? stringField(recordField(data, "usage"), "provider") ?? "global"}`,
      mode: "latest",
    };
  }

  if (
    event.type === "conversation.live.content.delta" ||
    event.type === "conversation.live.tool_draft.delta"
  ) {
    const key = eventKey(data, [
      "conversationId",
      "runId",
      "turnId",
      "liveMessageId",
      "contentBlockId",
      "contentIndex",
      "kind",
      "toolName",
      "providerToolCallId",
    ]);
    return key
      ? { key: `${event.type}:${key}`, mode: "concat_delta" }
      : undefined;
  }

  if (event.type === "conversation.live.tool_output.delta") {
    const key = eventKey(data, [
      "conversationId",
      "toolCallId",
      "stream",
      "runId",
      "turnId",
      "liveMessageId",
      "contentIndex",
    ]);
    return key
      ? { key: `${event.type}:${key}`, mode: "concat_delta" }
      : undefined;
  }

  if (
    event.type.endsWith(".progress") ||
    event.type.endsWith(".updated") ||
    event.type.endsWith(".retrying") ||
    event.type === "conversation.compaction.started" ||
    event.type === "conversation.live.tool_draft.progress"
  ) {
    const key = eventKey(data, [
      "conversationId",
      "agentId",
      "runId",
      "taskId",
      "toolCallId",
      "projectId",
      "contentBlockId",
    ]);
    if (key) return { key: `${event.type}:${key}`, mode: "latest" };
  }

  return undefined;
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
  fields: string[],
): string | undefined {
  const parts = fields
    .map((field) => data[field])
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

function recordField(
  data: Record<string, unknown>,
  field: string,
): Record<string, unknown> | undefined {
  const value = data[field];
  return isRecord(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function estimatedQueueBytes(
  control: NerveMessage[],
  replay: EventEnvelope[][],
  durable: EventEnvelope[],
  transient: EventEnvelope[],
): number {
  return (
    control.reduce((sum, value) => sum + estimatedBytes(value), 0) +
    replay.reduce((sum, value) => sum + estimatedBytes(value), 0) +
    durable.reduce((sum, value) => sum + estimatedBytes(value), 0) +
    transient.reduce((sum, value) => sum + estimatedBytes(value), 0)
  );
}

function estimatedBytes(value: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(value), "utf8");
  } catch {
    return 512;
  }
}
