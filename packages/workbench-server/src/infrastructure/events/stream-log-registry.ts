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
import type { RenameDependencies } from "../storage/index.js";
import type { PerformanceDiagnosticsPort } from "../../core/ports.js";
import { StreamLog, type StreamFlushObservation } from "./stream-log.js";

export type PublishedEvent<T = unknown> = EventEnvelope<T> | NotifyEvent<T>;

export interface EventPublishFailure {
  readonly type: string;
  readonly context: string;
  readonly error: unknown;
}

export interface StreamLogRegistryOptions {
  readonly retentionEvents?: number;
  readonly retentionBytes?: number;
  readonly flushDelayMs?: number;
  readonly flushEventThreshold?: number;
  readonly diagnostics?: PerformanceDiagnosticsPort;
  readonly onFsync?: () => void;
  readonly onFlushCompleted?: (observation: StreamFlushObservation) => void;
  readonly onPublishFailed?: (
    failure: EventPublishFailure,
  ) => void | Promise<void>;
  readonly renameDependencies?: RenameDependencies;
}

export class StreamLogRegistry {
  readonly #logs = new Map<string, Promise<StreamLog>>();
  readonly #intentResults = new Map<string, PublishedEvent>();
  readonly #sequencedListeners = new Set<
    (stream: string, event: EventEnvelope) => void
  >();
  readonly #eventListeners = new Set<(event: EventEnvelope) => void>();
  readonly #notifyListeners = new Set<(event: NotifyEvent) => void>();
  readonly #streamTails = new Map<string, Promise<unknown>>();
  readonly #intentTails = new Map<string, Promise<unknown>>();
  #conversationRevision?: (conversationId: string) => number | undefined;

  constructor(
    private readonly home: string,
    private readonly options: StreamLogRegistryOptions = {},
  ) {}

  setConversationRevisionResolver(
    resolve: (conversationId: string) => number | undefined,
  ): void {
    this.#conversationRevision = resolve;
  }

  async hydrate(): Promise<void> {
    await this.#log(WORKSPACE_STREAM);
  }

  publish<T>(type: string, data: T): Promise<PublishedEvent<T>> {
    const normalized = validatePublicEvent(
      type,
      this.#withConversationRevision(data),
      "workbench_server",
    ) as T;
    return this.#enqueueStream(eventQueueKey(type, normalized), () =>
      this.#publishNow(createId("evt"), type, normalized, true),
    );
  }

  /** Publish an intentionally lossy event without leaking a rejected promise. */
  publishBestEffort<T>(type: string, data: T, context: string): void {
    void this.publishBestEffortAndWait(type, data, context);
  }

  /**
   * Await a best-effort publication while containing both synchronous
   * validation errors and asynchronous persistence failures.
   */
  async publishBestEffortAndWait<T>(
    type: string,
    data: T,
    context: string,
  ): Promise<boolean> {
    try {
      await this.publish(type, data);
      return true;
    } catch (error) {
      this.#reportPublishFailure({ type, context, error });
      return false;
    }
  }

  publishWithId<T>(
    intentId: string,
    type: string,
    data: T,
  ): Promise<PublishedEvent<T>> {
    const normalized = validatePublicEvent(
      type,
      this.#withConversationRevision(data),
      "workbench_server",
    ) as T;
    return this.#enqueueIntent(intentId, () =>
      this.#enqueueStream(eventQueueKey(type, normalized), async () => {
        const existing = this.#intentResults.get(intentId);
        if (existing) {
          if (
            existing.type !== type ||
            JSON.stringify(existing.data) !== JSON.stringify(normalized)
          ) {
            throw new Error(`Conflicting event intent id: ${intentId}`);
          }
          return existing as PublishedEvent<T>;
        }
        return this.#publishNow(intentId, type, normalized, true);
      }),
    );
  }

  withCursor<T>(
    stream: string,
    build: () => T | Promise<T>,
  ): Promise<{ value: T; cursor: { stream: string; processedSeq: number } }> {
    return this.#enqueueStream(stream, async () => {
      const value = await build();
      const processedSeq = (await this.#log(stream)).bounds().latestSeq;
      return { value, cursor: { stream, processedSeq } };
    });
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

  removeConversationStream(conversationId: string): Promise<void> {
    const stream = `conv/${conversationId}`;
    return this.#enqueueStream(stream, async () => {
      const pending = this.#logs.get(stream);
      this.#logs.delete(stream);
      const log = pending ? await pending : await this.#openLog(stream);
      await log.remove();
    });
  }

  async settled(): Promise<void> {
    while (this.#streamTails.size > 0 || this.#intentTails.size > 0) {
      await Promise.allSettled([
        ...this.#streamTails.values(),
        ...this.#intentTails.values(),
      ]);
    }
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
      this.options.diagnostics?.count("event.ephemeral");
      const event: NotifyEvent<T> = { id, ts, type, data: normalized };
      this.#intentResults.set(id, event as NotifyEvent);
      for (const listener of this.#notifyListeners) {
        this.options.diagnostics?.count("event.listenerDelivery");
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
    this.options.diagnostics?.count("event.durable");
    this.#intentResults.set(id, event as EventEnvelope);
    for (const listener of this.#eventListeners) {
      this.options.diagnostics?.count("event.listenerDelivery");
      safelyNotify(() => listener(event as EventEnvelope), event.type);
    }
    for (const listener of this.#sequencedListeners) {
      this.options.diagnostics?.count("event.listenerDelivery");
      safelyNotify(() => listener(stream, event as EventEnvelope), event.type);
    }
    return event;
  }

  #enqueueStream<T>(key: string, operation: () => Promise<T>): Promise<T> {
    return enqueue(this.#streamTails, key, operation);
  }

  #enqueueIntent<T>(key: string, operation: () => Promise<T>): Promise<T> {
    return enqueue(this.#intentTails, key, operation);
  }

  #log(stream: string): Promise<StreamLog> {
    const existing = this.#logs.get(stream);
    if (existing) return existing;
    const opened = this.#openLog(stream);
    this.#logs.set(stream, opened);
    opened.catch(() => this.#logs.delete(stream));
    return opened;
  }

  #withConversationRevision<T>(data: T): T | Record<string, unknown> {
    if (
      !this.#conversationRevision ||
      !data ||
      typeof data !== "object" ||
      Array.isArray(data)
    ) {
      return data;
    }
    const record = data as Record<string, unknown>;
    if (
      typeof record.conversationId !== "string" ||
      typeof record.conversationRevision === "number"
    ) {
      return data;
    }
    const revision = this.#conversationRevision(record.conversationId);
    return revision === undefined
      ? data
      : { ...record, conversationRevision: revision };
  }

  #reportPublishFailure(failure: EventPublishFailure): void {
    this.options.diagnostics?.count("event.publishFailure");
    const report = this.options.onPublishFailed;
    if (!report) {
      process.emitWarning(
        `Best-effort event publication failed for ${failure.type} (${failure.context})`,
      );
      return;
    }
    try {
      void Promise.resolve(report(failure)).catch(() => undefined);
    } catch {
      // Diagnostics must not turn a contained publication failure back into an
      // unhandled process error.
    }
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

const EPHEMERAL_QUEUE = "@ephemeral";

function eventQueueKey(type: string, data: unknown): string {
  const definition = publicEventDefinition(type);
  if (!definition) throw new Error(`Unknown public event: ${type}`);
  return definition.delivery === "ephemeral"
    ? EPHEMERAL_QUEUE
    : streamForEvent(type, data);
}

function enqueue<T>(
  tails: Map<string, Promise<unknown>>,
  key: string,
  operation: () => Promise<T>,
): Promise<T> {
  const previous = tails.get(key) ?? Promise.resolve();
  const task = previous.catch(() => undefined).then(operation);
  const tail = task.then(
    () => undefined,
    () => undefined,
  );
  tails.set(key, tail);
  void tail.finally(() => {
    if (tails.get(key) === tail) tails.delete(key);
  });
  return task;
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
