import {
  type NotifyEvent,
  type ProtocolLimits,
  type SandboxOutboxRecord,
  type StructuredLogger,
  publicEventDefinition,
} from "@nervekit/contracts";
import {
  buildEventBatch,
  chunkEvents,
  type ProtocolClientSession,
} from "@nervekit/protocol";
import type { EventOutbox } from "../state/event-outbox.js";

const DEFAULT_COALESCE_DELAY_MS = 12;
const MAX_PENDING_NOTIFY = 256;

export class SandboxEventRelay {
  readonly #queue: SandboxOutboxRecord[] = [];
  readonly #queuedSeqs = new Set<number>();
  readonly #notifyQueue: NotifyEvent[] = [];
  #session?: ProtocolClientSession;
  #limits?: ProtocolLimits;
  #unsubscribe?: () => void;
  #unsubscribeNotify?: () => void;
  #tail: Promise<unknown> = Promise.resolve();
  #timer?: NodeJS.Timeout;
  #generation = 0;

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
    this.#unsubscribeNotify ??= this.outbox.subscribeNotify((event) => {
      void this.#serialize(async () => {
        if (!this.#session) return;
        this.#enqueueNotify(event);
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
      const agentLatestSeq = this.outbox.latestSeq();
      // Report the agent's durable high-water before reconciling. The manager
      // can archive a stale journal epoch and return its reset cursor here.
      const subscription = await session.subscribe([
        { stream: this.stream, processedSeq: agentLatestSeq },
      ]);
      const managerState = subscription.streams.find(
        (candidate) => candidate.stream === this.stream,
      );
      if (!managerState)
        throw new Error("Manager omitted the sandbox stream state");
      const managerProcessedSeq = managerState.latestSeq;
      if (managerProcessedSeq > agentLatestSeq)
        throw new Error(
          "Manager sandbox cursor remained ahead after epoch reconciliation",
        );
      const pending = this.outbox.since(managerProcessedSeq);
      let expectedSeq = managerProcessedSeq + 1;
      for (const record of pending) {
        if (record.seq !== expectedSeq)
          throw new Error(
            `Agent outbox gap: expected ${expectedSeq}, received ${record.seq}`,
          );
        expectedSeq += 1;
      }
      if (expectedSeq !== agentLatestSeq + 1)
        throw new Error(
          `Agent outbox gap: expected ${expectedSeq}, high-water is ${agentLatestSeq}`,
        );
      await this.outbox.truncateThrough(managerProcessedSeq);
      for (const record of pending) this.#enqueue(record);
      const generation = this.#generation;
      await this.#drain(generation, "replay");
      return generation;
    });
  }

  disconnect(): void {
    void this.#serialize(() => this.#resetConnectionState());
  }

  stop(): void {
    this.#unsubscribe?.();
    this.#unsubscribe = undefined;
    this.#unsubscribeNotify?.();
    this.#unsubscribeNotify = undefined;
    this.disconnect();
  }

  #enqueue(record: SandboxOutboxRecord): void {
    if (this.#queuedSeqs.has(record.seq)) return;
    this.#queue.push(record);
    this.#queue.sort((left, right) => left.seq - right.seq);
    this.#queuedSeqs.add(record.seq);
  }

  #enqueueNotify(event: NotifyEvent): void {
    const definition = publicEventDefinition(event.type);
    if (definition?.coalescing === "latest_by_scope") {
      const key = notifyKey(event, definition.scope);
      const existing = this.#notifyQueue.findIndex(
        (candidate) => notifyKey(candidate, definition.scope) === key,
      );
      if (existing >= 0) this.#notifyQueue.splice(existing, 1);
    }
    this.#notifyQueue.push(event);
    while (this.#notifyQueue.length > MAX_PENDING_NOTIFY) {
      this.#notifyQueue.shift();
    }
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
    ) {
      return;
    }
    let sentThroughSeq: number | undefined;
    while (this.#queue.length > 0 && generation === this.#generation) {
      const chunks = chunkEvents(
        this.#queue.map(toProtocolEvent),
        limits.maxBatchEvents,
        limits.maxBatchBytes,
      );
      const events = chunks[0] ?? [];
      if (events.length === 0) break;
      const records = this.#queue.splice(0, events.length);
      for (const record of records) this.#queuedSeqs.delete(record.seq);
      await session.publishEventBatch(
        buildEventBatch(events, { stream: this.stream, reason }),
      );
      sentThroughSeq = events.at(-1)?.seq;
      this.logger?.debug("sandbox event relay batch sent", {
        stream: this.stream,
        generation,
        reason,
        events: events.length,
        queueDepth: this.#queue.length,
      });
    }
    if (sentThroughSeq !== undefined && generation === this.#generation) {
      const updated = await session.subscribe([
        { stream: this.stream, processedSeq: sentThroughSeq },
      ]);
      const managerState = updated.streams.find(
        (stream) => stream.stream === this.stream,
      );
      if (!managerState)
        throw new Error(
          "Manager omitted the sandbox stream subscription state",
        );
      if (managerState.latestSeq > sentThroughSeq)
        throw new Error("Manager sandbox cursor is ahead of the agent outbox");
      await this.outbox.truncateThrough(managerState.latestSeq);
    }
    while (this.#notifyQueue.length > 0 && generation === this.#generation) {
      const events = this.#notifyQueue.splice(0, limits.maxBatchEvents);
      await session.publishNotify({ events });
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
    this.#notifyQueue.length = 0;
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
    data: record.data,
  };
}

function notifyKey(event: NotifyEvent, scope: readonly string[]): string {
  return `${event.type}:${scope.map((path) => JSON.stringify(readPath(event.data, path))).join(":")}`;
}

function readPath(value: unknown, path: string): unknown {
  let current = value;
  for (const segment of path.split(".")) {
    if (!current || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function boundedError(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 512);
}
