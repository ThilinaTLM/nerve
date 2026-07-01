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

function estimatedBytes(value: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(value), "utf8");
  } catch {
    return 512;
  }
}
