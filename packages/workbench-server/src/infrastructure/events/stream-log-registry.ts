import { join } from "node:path";
import {
  createId,
  type EventEnvelope,
  type NotifyEvent,
  type StreamState,
  WORKSPACE_STREAM,
  parseConversationStream,
  publicEventDefinition,
  streamForEvent,
  validatePublicEvent,
} from "@nervekit/contracts";
import { StreamLog } from "./stream-log.js";

export type PublishedEvent<T = unknown> = EventEnvelope<T> | NotifyEvent<T>;

export interface StreamLogRegistryOptions {
  readonly retentionEvents?: number;
  readonly retentionBytes?: number;
  readonly flushDelayMs?: number;
  readonly flushEventThreshold?: number;
  readonly onFsync?: () => void;
}

export class StreamLogRegistry {
  readonly #logs = new Map<string, Promise<StreamLog>>();
  readonly #intentResults = new Map<string, PublishedEvent>();
  readonly #sequencedListeners = new Set<
    (stream: string, event: EventEnvelope) => void
  >();
  readonly #eventListeners = new Set<(event: EventEnvelope) => void>();
  readonly #notifyListeners = new Set<(event: NotifyEvent) => void>();
  #publishTail: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly home: string,
    private readonly options: StreamLogRegistryOptions = {},
  ) {}

  async hydrate(): Promise<void> {
    await this.#log(WORKSPACE_STREAM);
  }

  publish<T>(type: string, data: T): Promise<PublishedEvent<T>> {
    const task = this.#publishTail.then(() =>
      this.#publishNow(createId("evt"), type, data),
    );
    this.#publishTail = task.catch(() => undefined);
    return task;
  }

  publishWithId<T>(
    intentId: string,
    type: string,
    data: T,
  ): Promise<PublishedEvent<T>> {
    const task = this.#publishTail.then(async () => {
      const existing = this.#intentResults.get(intentId);
      const normalized = validatePublicEvent(type, data, "workbench_server");
      if (existing) {
        if (
          existing.type !== type ||
          JSON.stringify(existing.data) !== JSON.stringify(normalized)
        ) {
          throw new Error(`Conflicting event intent id: ${intentId}`);
        }
        return existing as PublishedEvent<T>;
      }
      return this.#publishNow(intentId, type, normalized as T, true);
    });
    this.#publishTail = task.catch(() => undefined);
    return task;
  }

  async withCursor<T>(
    stream: string,
    build: () => T | Promise<T>,
  ): Promise<{ value: T; cursor: { stream: string; processedSeq: number } }> {
    const task = this.#publishTail.then(async () => {
      const value = await build();
      const processedSeq = (await this.#log(stream)).bounds().latestSeq;
      return { value, cursor: { stream, processedSeq } };
    });
    this.#publishTail = task.catch(() => undefined);
    return task;
  }

  async readStream(
    stream: string,
    fromSeq: number,
    limit: number,
  ): Promise<StreamState & { events: readonly EventEnvelope[] }> {
    const log = await this.#log(stream);
    return { ...log.bounds(), events: log.read(fromSeq, limit) };
  }

  async bounds(stream: string): Promise<StreamState> {
    return (await this.#log(stream)).bounds();
  }

  async latestSeq(stream: string): Promise<number> {
    return (await this.#log(stream)).bounds().latestSeq;
  }

  subscribe(listener: (event: EventEnvelope) => void): () => void {
    this.#eventListeners.add(listener);
    return () => this.#eventListeners.delete(listener);
  }

  subscribeSequenced(
    listener: (stream: string, event: EventEnvelope) => void,
  ): () => void {
    this.#sequencedListeners.add(listener);
    return () => this.#sequencedListeners.delete(listener);
  }

  subscribeNotify(listener: (event: NotifyEvent) => void): () => void {
    this.#notifyListeners.add(listener);
    return () => this.#notifyListeners.delete(listener);
  }

  async removeConversationStream(conversationId: string): Promise<void> {
    const stream = `conv/${conversationId}`;
    const pending = this.#logs.get(stream);
    this.#logs.delete(stream);
    const log = pending ? await pending : await this.#openLog(stream);
    await log.remove();
  }

  async settled(): Promise<void> {
    await this.#publishTail.catch(() => undefined);
  }

  async flush(): Promise<void> {
    await this.settled();
    await Promise.all(
      [...this.#logs.values()].map(async (log) => (await log).flush()),
    );
  }

  async shutdown(): Promise<void> {
    await this.settled();
    await Promise.all(
      [...this.#logs.values()].map(async (log) => (await log).close()),
    );
    this.#logs.clear();
  }

  async #publishNow<T>(
    id: string,
    type: string,
    data: T,
    alreadyValidated = false,
  ): Promise<PublishedEvent<T>> {
    const definition = publicEventDefinition(type);
    if (!definition) throw new Error(`Unknown public event: ${type}`);
    const normalized = alreadyValidated
      ? data
      : (validatePublicEvent(type, data, "workbench_server") as T);
    const ts = new Date().toISOString();

    if (definition.delivery === "ephemeral") {
      const event: NotifyEvent<T> = { id, ts, type, data: normalized };
      this.#intentResults.set(id, event as NotifyEvent);
      for (const listener of this.#notifyListeners) {
        safelyNotify(() => listener(event as NotifyEvent), event.type);
      }
      return event;
    }

    const stream = streamForEvent(type, normalized);
    const log = await this.#log(stream);
    const existing = log.eventForIntent(id);
    if (existing) {
      if (
        existing.type !== type ||
        JSON.stringify(existing.data) !== JSON.stringify(normalized)
      )
        throw new Error(`Conflicting event intent id: ${id}`);
      this.#intentResults.set(id, existing);
      return existing as EventEnvelope<T>;
    }
    const event = (await log.append(
      id,
      type,
      normalized,
      definition.supersedable,
      ts,
    )) as EventEnvelope<T>;
    this.#intentResults.set(id, event as EventEnvelope);
    for (const listener of this.#eventListeners) {
      safelyNotify(() => listener(event as EventEnvelope), event.type);
    }
    for (const listener of this.#sequencedListeners) {
      safelyNotify(() => listener(stream, event as EventEnvelope), event.type);
    }
    return event;
  }

  #log(stream: string): Promise<StreamLog> {
    const existing = this.#logs.get(stream);
    if (existing) return existing;
    const opened = this.#openLog(stream);
    this.#logs.set(stream, opened);
    opened.catch(() => this.#logs.delete(stream));
    return opened;
  }

  #openLog(stream: string): Promise<StreamLog> {
    const paths = streamPaths(this.home, stream);
    return StreamLog.open({
      stream,
      ...paths,
      ...this.options,
    });
  }
}

function streamPaths(
  home: string,
  stream: string,
): { logPath: string; metaPath: string } {
  if (stream === WORKSPACE_STREAM) {
    return {
      logPath: join(home, "logs", "workspace-events.jsonl"),
      metaPath: join(home, "logs", "workspace-events.meta.json"),
    };
  }
  const conversationId = parseConversationStream(stream);
  if (conversationId) {
    return {
      logPath: join(home, "conversations", conversationId, "events.jsonl"),
      metaPath: join(home, "conversations", conversationId, "events.meta.json"),
    };
  }
  const safeStream = stream.replaceAll(/[^a-zA-Z0-9._-]/g, "_");
  return {
    logPath: join(home, "logs", `${safeStream}-events.jsonl`),
    metaPath: join(home, "logs", `${safeStream}-events.meta.json`),
  };
}

function safelyNotify(callback: () => void, type: string): void {
  try {
    callback();
  } catch (error) {
    process.emitWarning(
      `Event listener failed for ${type}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
