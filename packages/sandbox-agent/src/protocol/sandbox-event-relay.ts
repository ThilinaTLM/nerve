import type {
  ProtocolLimits,
  ProtocolV1Message,
  SandboxOutboxRecord,
  StructuredLogger,
} from "@nervekit/contracts";
import {
  buildEventBatch,
  chunkEvents,
  type ProtocolClientSession,
} from "@nervekit/protocol";
import type { EventOutbox } from "../state/event-outbox.js";

const DEFAULT_COALESCE_DELAY_MS = 12;
const MAX_PENDING_TRANSIENT = 256;

type InFlightBatch = {
  highestDurableSeq?: number;
  sentAt: number;
};

export class SandboxEventRelay {
  readonly #queue: SandboxOutboxRecord[] = [];
  readonly #queuedSeqs = new Set<number>();
  readonly #inFlight = new Map<string, InFlightBatch>();
  #session?: ProtocolClientSession;
  #limits?: ProtocolLimits;
  #unsubscribe?: () => void;
  #tail: Promise<unknown> = Promise.resolve();
  #timer?: NodeJS.Timeout;
  #generation = 0;
  #persistedAck = 0;
  #sentDurableHighWater = 0;
  #pausedTransient = false;

  constructor(
    private readonly outbox: EventOutbox,
    readonly stream: string,
    private readonly logger?: StructuredLogger,
    private readonly coalesceDelayMs = DEFAULT_COALESCE_DELAY_MS,
  ) {}

  start(): void {
    this.#unsubscribe ??= this.outbox.subscribe((record) => {
      void this.#serialize(async () => {
        if (!this.#session) return;
        this.#enqueue(record);
        this.#scheduleDrain();
      });
    });
  }

  async attach(
    session: ProtocolClientSession,
    limits: ProtocolLimits,
  ): Promise<number> {
    return this.#serialize(async () => {
      this.#resetConnectionState();
      this.#session = session;
      this.#limits = limits;
      const ack = await this.outbox.ackState();
      this.#persistedAck =
        ack.streams.find((cursor) => cursor.stream === this.stream)
          ?.processedSeq ?? 0;
      this.#sentDurableHighWater = this.#persistedAck;
      for (const record of this.outbox.unacked(this.#persistedAck))
        this.#enqueue(record);
      const generation = this.#generation;
      await this.#drain(generation, "replay");
      return generation;
    });
  }

  disconnect(): void {
    void this.#serialize(() => {
      this.#resetConnectionState();
    });
  }

  stop(): void {
    this.#unsubscribe?.();
    this.#unsubscribe = undefined;
    this.disconnect();
  }

  async acknowledge(
    message: ProtocolV1Message & { kind: "event.ack" },
    generation: number,
  ): Promise<number> {
    return this.#serialize(async () => {
      if (generation !== this.#generation) return this.#persistedAck;
      const cursor = message.data.streams.find(
        (candidate) => candidate.stream === this.stream,
      );
      if (!cursor) return this.#persistedAck;
      const processedSeq = Math.max(this.#persistedAck, cursor.processedSeq);
      if (processedSeq > this.#persistedAck) {
        await this.outbox.ack(this.stream, processedSeq);
        this.#persistedAck = processedSeq;
      }
      let ackLatencyMs: number | undefined;
      for (const [batchId, batch] of this.#inFlight) {
        if (
          batchId === message.data.ackId ||
          (batch.highestDurableSeq !== undefined &&
            batch.highestDurableSeq <= processedSeq)
        ) {
          ackLatencyMs = Math.max(ackLatencyMs ?? 0, Date.now() - batch.sentAt);
          this.#inFlight.delete(batchId);
        }
      }
      this.logger?.debug("sandbox event relay ACK", {
        stream: this.stream,
        generation,
        processedSeq,
        sentDurableHighWater: this.#sentDurableHighWater,
        inflightBatches: this.#inFlight.size,
        ackLatencyMs,
      });
      await this.#drain(generation, "live");
      return this.#persistedAck;
    });
  }

  handleFlow(message: ProtocolV1Message & { kind: "flow.update" }): void {
    void this.#serialize(async () => {
      if (
        message.data.scope.stream &&
        message.data.scope.stream !== this.stream
      )
        return;
      this.#pausedTransient = message.data.action?.type === "pause_transient";
      if (this.#pausedTransient) this.#dropPendingTransient();
      this.logger?.warn("sandbox event relay flow control", {
        stream: this.stream,
        mode: message.data.mode,
        reason: message.data.reason,
        action: message.data.action?.type,
        queueDepth: this.#queue.length,
        inflightBatches: this.#inFlight.size,
      });
    });
  }

  #enqueue(record: SandboxOutboxRecord): void {
    if (record.seq <= this.#persistedAck || this.#queuedSeqs.has(record.seq))
      return;
    if (record.durability === "transient" && this.#pausedTransient) return;
    if (
      record.durability === "durable" &&
      record.seq <= this.#sentDurableHighWater
    )
      return;
    this.#queue.push(record);
    this.#queue.sort((left, right) => left.seq - right.seq);
    this.#queuedSeqs.add(record.seq);
    this.#boundTransientQueue();
  }

  #scheduleDrain(): void {
    if (!this.#session || this.#timer) return;
    if ((this.#limits?.maxBatchEvents ?? 1) <= this.#queue.length) {
      void this.#serialize(() => this.#drain(this.#generation, "live"));
      return;
    }
    this.#timer = setTimeout(() => {
      this.#timer = undefined;
      void this.#serialize(() => this.#drain(this.#generation, "live")).catch(
        (error: unknown) =>
          this.logger?.warn("sandbox event relay drain failed", {
            error: boundedError(error),
          }),
      );
    }, this.coalesceDelayMs);
    this.#timer.unref();
  }

  async #drain(generation: number, reason: "live" | "replay"): Promise<void> {
    const session = this.#session;
    const limits = this.#limits;
    if (
      generation !== this.#generation ||
      !session ||
      session.state !== "ready" ||
      !limits
    )
      return;
    while (
      this.#queue.length > 0 &&
      this.#inFlight.size < limits.maxInflightBatches &&
      generation === this.#generation &&
      session.state === "ready"
    ) {
      const chunks = chunkEvents(
        this.#queue.map(toProtocolEvent),
        limits.maxBatchEvents,
        limits.maxBatchBytes,
      );
      const events = chunks[0] ?? [];
      if (events.length === 0) return;
      const records = this.#queue.splice(0, events.length);
      for (const record of records) this.#queuedSeqs.delete(record.seq);
      const data = buildEventBatch(events, {
        stream: this.stream,
        reason,
        previousDurableSeq: this.#sentDurableHighWater,
      });
      const durable = records.filter(
        (record) => record.durability === "durable",
      );
      const highestDurableSeq = durable.at(-1)?.seq;
      this.#inFlight.set(data.batchId, {
        highestDurableSeq,
        sentAt: Date.now(),
      });
      if (highestDurableSeq !== undefined)
        this.#sentDurableHighWater = highestDurableSeq;
      try {
        await session.publishEventBatch(data);
      } catch (error) {
        this.#inFlight.delete(data.batchId);
        throw error;
      }
      this.logger?.debug("sandbox event relay batch sent", {
        stream: this.stream,
        generation,
        reason,
        events: events.length,
        durableEvents: durable.length,
        queueDepth: this.#queue.length,
        inflightBatches: this.#inFlight.size,
        sentDurableHighWater: this.#sentDurableHighWater,
      });
    }
  }

  #boundTransientQueue(): void {
    let transientCount = this.#queue.reduce(
      (count, record) => count + (record.durability === "transient" ? 1 : 0),
      0,
    );
    if (transientCount <= MAX_PENDING_TRANSIENT) return;
    for (let index = 0; index < this.#queue.length;) {
      const record = this.#queue[index] as SandboxOutboxRecord;
      if (record.durability === "transient") {
        this.#queue.splice(index, 1);
        this.#queuedSeqs.delete(record.seq);
        transientCount -= 1;
        if (transientCount <= MAX_PENDING_TRANSIENT) break;
      } else index += 1;
    }
  }

  #dropPendingTransient(): void {
    for (let index = this.#queue.length - 1; index >= 0; index -= 1) {
      const record = this.#queue[index] as SandboxOutboxRecord;
      if (record.durability !== "transient") continue;
      this.#queue.splice(index, 1);
      this.#queuedSeqs.delete(record.seq);
    }
  }

  #resetConnectionState(): void {
    this.#generation += 1;
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = undefined;
    this.#session = undefined;
    this.#limits = undefined;
    this.#queue.length = 0;
    this.#queuedSeqs.clear();
    this.#inFlight.clear();
    this.#sentDurableHighWater = this.#persistedAck;
    this.#pausedTransient = false;
  }

  #serialize<T>(operation: () => T | Promise<T>): Promise<T> {
    const next = this.#tail.catch(() => undefined).then(operation);
    this.#tail = next.catch(() => undefined);
    return next;
  }
}

function toProtocolEvent(record: SandboxOutboxRecord) {
  return {
    id: record.id,
    seq: record.seq,
    type: record.type,
    ts: record.ts,
    durability: record.durability,
    data: record.data,
  };
}

function boundedError(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 512);
}
