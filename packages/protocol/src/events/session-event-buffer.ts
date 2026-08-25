import type { EventEnvelope, NotifyEvent } from "@nervekit/contracts";
import { estimateProtocolMessageBytes } from "./event-batch.js";

export interface SessionNotificationDefinition {
  readonly scope: readonly string[];
  readonly coalescing?:
    | {
        readonly strategy: "latest_by_scope";
      }
    | {
        readonly strategy: "concat_delta";
        readonly field: "delta" | "text";
        readonly offsetField?: "offset";
        readonly maxChars: number;
      };
}

export interface SessionEventBufferOptions {
  readonly maxBufferedEvents: number;
  readonly maxBufferedBytes: number;
  readonly notifyQueueLimit: number;
  readonly onOverflow: (message: string) => void;
}

/** Owns live/replay buffering and ephemeral notification coalescing. */
export class SessionEventBuffer {
  readonly #options: SessionEventBufferOptions;
  readonly #pendingLive = new Map<string, EventEnvelope[]>();
  readonly #replayBufferedLive = new Map<string, EventEnvelope[]>();
  readonly #notifyQueue: NotifyEvent[] = [];

  constructor(options: SessionEventBufferOptions) {
    this.#options = options;
  }

  enqueueLive(
    stream: string,
    event: EventEnvelope,
    replaying: boolean,
  ): boolean {
    const queues = replaying ? this.#replayBufferedLive : this.#pendingLive;
    const queue = queues.get(stream) ?? [];
    queue.push(event);
    queues.set(stream, queue);
    return this.checkBufferLimit();
  }

  enqueueNotification(
    event: NotifyEvent,
    definition: SessionNotificationDefinition,
    parseData: (data: unknown) => unknown,
  ): boolean {
    const coalescing = definition.coalescing;
    if (coalescing?.strategy === "latest_by_scope") {
      const key = notifyScopeKey(event, definition.scope);
      const index = this.#notifyQueue.findIndex(
        (queued) => notifyScopeKey(queued, definition.scope) === key,
      );
      if (index >= 0) this.#notifyQueue.splice(index, 1);
    } else if (coalescing?.strategy === "concat_delta") {
      const previous = this.#notifyQueue.at(-1);
      const merged = previous
        ? mergeNotifyDelta(previous, event, definition.scope, coalescing)
        : undefined;
      if (merged) {
        this.#notifyQueue[this.#notifyQueue.length - 1] = {
          ...merged,
          data: parseData(merged.data),
        };
        return this.checkBufferLimit();
      }
    }
    this.#notifyQueue.push(event);
    while (this.#notifyQueue.length > this.#options.notifyQueueLimit)
      this.#notifyQueue.shift();
    return this.checkBufferLimit();
  }

  takePendingLive(): Map<string, EventEnvelope[]> {
    const pending = new Map(this.#pendingLive);
    this.#pendingLive.clear();
    return pending;
  }

  takeNotifications(): NotifyEvent[] {
    return this.#notifyQueue.splice(0);
  }

  takeReplayBuffered(stream: string): EventEnvelope[] {
    const buffered = this.#replayBufferedLive.get(stream) ?? [];
    this.#replayBufferedLive.delete(stream);
    return buffered;
  }

  dropInactive(activeStreams: ReadonlySet<string>): void {
    for (const stream of this.#pendingLive.keys()) {
      if (!activeStreams.has(stream)) this.#pendingLive.delete(stream);
    }
    for (const stream of this.#replayBufferedLive.keys()) {
      if (!activeStreams.has(stream)) this.#replayBufferedLive.delete(stream);
    }
  }

  removeStream(stream: string): void {
    this.#pendingLive.delete(stream);
    this.#replayBufferedLive.delete(stream);
  }

  clear(): void {
    this.#pendingLive.clear();
    this.#replayBufferedLive.clear();
    this.#notifyQueue.splice(0);
  }

  private checkBufferLimit(): boolean {
    const events = [
      ...this.#pendingLive.values(),
      ...this.#replayBufferedLive.values(),
    ].reduce((count, queue) => count + queue.length, this.#notifyQueue.length);
    const bytes = [
      ...this.#pendingLive.values(),
      ...this.#replayBufferedLive.values(),
    ]
      .flat()
      .reduce(
        (total, event) => total + estimateProtocolMessageBytes("event", event),
        this.#notifyQueue.reduce(
          (total, event) =>
            total + estimateProtocolMessageBytes("notify", event),
          0,
        ),
      );
    if (
      events > this.#options.maxBufferedEvents ||
      bytes > this.#options.maxBufferedBytes
    ) {
      this.#options.onOverflow("Outgoing event buffer exceeded");
      return false;
    }
    return true;
  }
}

function notifyScopeKey(event: NotifyEvent, scope: readonly string[]): string {
  return `${event.type}:${scope.map((path) => JSON.stringify(readPath(event.data, path))).join(":")}`;
}

function mergeNotifyDelta(
  previous: NotifyEvent,
  current: NotifyEvent,
  scope: readonly string[],
  coalescing: {
    readonly field: "delta" | "text";
    readonly offsetField?: "offset";
    readonly maxChars: number;
  },
): NotifyEvent | undefined {
  if (notifyScopeKey(previous, scope) !== notifyScopeKey(current, scope))
    return undefined;
  const previousData = previous.data as Record<string, unknown>;
  const currentData = current.data as Record<string, unknown>;
  const left = previousData[coalescing.field];
  const right = currentData[coalescing.field];
  if (typeof left !== "string" || typeof right !== "string") return undefined;
  const combined = `${left}${right}`;
  if (combined.length > coalescing.maxChars) return undefined;
  let firstOffset: number | undefined;
  if (coalescing.offsetField) {
    const previousOffset = previousData[coalescing.offsetField];
    const currentOffset = currentData[coalescing.offsetField];
    if (
      typeof previousOffset !== "number" ||
      typeof currentOffset !== "number" ||
      currentOffset !== previousOffset + left.length
    ) {
      return undefined;
    }
    firstOffset = previousOffset;
  }
  return {
    ...current,
    data: {
      ...currentData,
      [coalescing.field]: combined,
      ...(coalescing.offsetField
        ? { [coalescing.offsetField]: firstOffset }
        : {}),
    },
  };
}

function readPath(value: unknown, path: string): unknown {
  let current = value;
  for (const segment of path.split(".")) {
    if (typeof current !== "object" || current === null) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}
