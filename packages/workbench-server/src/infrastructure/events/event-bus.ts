import { appendFile, mkdir, rename, stat } from "node:fs/promises";
import { join } from "node:path";
import {
  createId,
  type EventDurability,
  type EventEnvelope,
  eventEnvelopeSchema,
  parsePublicEventEnvelope,
  publicEventDefinition,
} from "@nervekit/contracts";
import type { IndexStore } from "../../infrastructure/index-store/index.js";
import {
  filterJsonLinesToFile,
  forEachJsonLine,
  pathExists,
  readJsonLines,
  readJsonLinesTail,
} from "../storage/index.js";
import { conversationIdForEvent } from "./event-ref-extractor.js";

/** Max bytes the global event log may reach before it is rotated. */
const MAX_GLOBAL_EVENT_LOG_BYTES = 64 * 1024 * 1024;
/** Events streamed into the index per transaction during a full reindex. */
const REINDEX_BATCH_SIZE = 5_000;

export interface PublishEventOptions {
  durability?: EventDurability;
}

export type ProtocolReplaySource = "memory" | "index" | "log";

export interface ProtocolReplayOptions {
  toSeq?: number;
  includeTransientIfAvailable?: boolean;
}

export interface ProtocolReplayResult {
  events: EventEnvelope[];
  source: ProtocolReplaySource;
  replayAvailableFromSeq: number;
}

export interface DurableContinuityInfo {
  previousDurableSeq: number;
  durableFirstSeq?: number;
  durableLastSeq?: number;
  durableCount: number;
}

export class EventBus {
  #seq = 0;
  #latestDurableSeq = 0;
  #events: EventEnvelope[] = [];
  #listeners = new Set<(event: EventEnvelope) => void>();
  #publishTail: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly dataDir: string,
    private readonly index?: IndexStore,
    private readonly maxBufferedEvents = 10_000,
  ) {}

  /**
   * Seed the in-memory ring and sequence counters without ever loading the
   * whole (potentially multi-hundred-MB) event log into memory.
   *
   * When the SQLite index is available it is the query layer: we reconcile any
   * events the log holds beyond the index (e.g. written just before a crash),
   * then seed the ring from the index tail. When the index is unavailable we
   * fall back to a streaming tail read of the log file.
   */
  async hydrate(): Promise<void> {
    if (this.index?.isHealthy) {
      try {
        await this.reconcileIndexFromLog();
        const latest = this.index.latestEventSeq();
        this.#events = this.index.recentEvents(this.maxBufferedEvents);
        this.#latestDurableSeq = latest;
        this.#seq = latest;
        return;
      } catch {
        // Fall through to the file-based path below.
      }
    }
    const tail = await readJsonLinesTail<unknown>(
      this.globalEventsPath(),
      this.maxBufferedEvents,
    ).catch(() => []);
    const parsed = tail
      .map((event) => eventEnvelopeSchema.safeParse(event))
      .filter((result) => result.success)
      .map((result) => result.data as EventEnvelope)
      .sort((a, b) => a.seq - b.seq);
    this.#events = parsed;
    this.#latestDurableSeq = parsed.at(-1)?.seq ?? 0;
    this.#seq = this.#latestDurableSeq;
  }

  /**
   * Insert any durable events present in the log file but missing from the
   * index (seq greater than the index high-water mark). Streams the log so
   * memory stays bounded; inserts are idempotent (INSERT OR IGNORE on seq).
   */
  private async reconcileIndexFromLog(): Promise<void> {
    const index = this.index;
    if (!index) return;
    const indexLatest = index.latestEventSeq();
    let batch: EventEnvelope[] = [];
    const flush = () => {
      if (batch.length === 0) return;
      index.insertEventsBatch(batch);
      batch = [];
    };
    await forEachJsonLine<unknown>(this.globalEventsPath(), (raw) => {
      const result = eventEnvelopeSchema.safeParse(raw);
      if (!result.success) return;
      const event = result.data as EventEnvelope;
      if (event.seq <= indexLatest) return;
      if (event.durability !== "durable") return;
      batch.push(event);
      if (batch.length >= REINDEX_BATCH_SIZE) flush();
    });
    flush();
    index.checkpoint();
  }

  /**
   * Rebuild the entire events portion of the index from the durable log file.
   * Used by the admin "rebuild index" action. Streams the log in bounded
   * batches so a multi-hundred-MB log never lands in memory at once.
   */
  async reindexPersistedInto(index: IndexStore): Promise<void> {
    index.clearEvents();
    let batch: EventEnvelope[] = [];
    const flush = () => {
      if (batch.length === 0) return;
      index.insertEventsBatch(batch);
      batch = [];
    };
    // Read the rotated generation first (older seqs) then the active log so the
    // index is rebuilt from the full durable history, not just the recent tail.
    for (const path of [
      `${this.globalEventsPath()}.1`,
      this.globalEventsPath(),
    ]) {
      await forEachJsonLine<unknown>(path, (raw) => {
        const result = eventEnvelopeSchema.safeParse(raw);
        if (!result.success) return;
        const event = result.data as EventEnvelope;
        if (event.durability !== "durable") return;
        batch.push(event);
        if (batch.length >= REINDEX_BATCH_SIZE) flush();
      });
    }
    flush();
    index.checkpoint();
  }

  publish<T>(
    type: string,
    data: T,
    options: PublishEventOptions = {},
  ): Promise<EventEnvelope<T>> {
    const task = this.#publishTail.then(() =>
      this.publishNow(type, data, options),
    );
    this.#publishTail = task.catch(() => undefined);
    return task;
  }

  private async publishNow<T>(
    type: string,
    data: T,
    options: PublishEventOptions,
  ): Promise<EventEnvelope<T>> {
    const definition = publicEventDefinition(type);
    if (!definition) throw new Error(`Unknown public event: ${type}`);
    const durability = options.durability ?? definition.durability;
    const event = parsePublicEventEnvelope(
      {
        seq: this.#seq + 1,
        id: createId("evt"),
        ts: new Date().toISOString(),
        type,
        durability,
        data,
      },
      "workbench_server",
    ) as EventEnvelope<T>;
    this.#seq = event.seq;
    this.#events.push(event as EventEnvelope);
    if (this.#events.length > this.maxBufferedEvents) this.#events.shift();
    if (durability === "durable") {
      await this.persist(event);
      this.#latestDurableSeq = event.seq;
      this.index?.insertEvent(event as EventEnvelope);
    }
    for (const listener of this.#listeners) {
      try {
        listener(event as EventEnvelope);
      } catch (error) {
        process.emitWarning(
          `Event listener failed for ${event.type}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
    return event;
  }

  get latestSeq(): number {
    return this.#seq;
  }

  get latestDurableSeq(): number {
    return this.#latestDurableSeq;
  }

  /**
   * Oldest sequence still held in the in-memory ring buffer, or 0 when empty.
   * Callers can serve a `since` backlog from memory (cheap) instead of
   * re-reading the persisted log from disk whenever `since >= floor - 1`.
   */
  bufferedFloorSeq(): number {
    return this.#events[0]?.seq ?? 0;
  }

  replaySince(seq = 0): EventEnvelope[] {
    return this.#events.filter((event) => event.seq > seq);
  }

  async replayPersistedSince(seq = 0): Promise<EventEnvelope[]> {
    return (await this.replayPersistedSinceWithSource(seq)).events;
  }

  async previousDurableSeqBefore(seq: number): Promise<number> {
    const inMemory = [...this.#events]
      .reverse()
      .find((event) => event.durability === "durable" && event.seq < seq);
    if (inMemory) return inMemory.seq;
    if (this.index?.isHealthy) {
      try {
        return this.index.previousEventSeqBefore(seq);
      } catch {
        // Fall back to log scan below.
      }
    }
    let previous = 0;
    for (const path of [
      `${this.globalEventsPath()}.1`,
      this.globalEventsPath(),
    ]) {
      await forEachJsonLine<unknown>(path, (raw) => {
        const result = eventEnvelopeSchema.safeParse(raw);
        if (!result.success) return;
        const event = result.data as EventEnvelope;
        if (event.durability === "durable" && event.seq < seq) {
          previous = Math.max(previous, event.seq);
        }
      });
    }
    return previous;
  }

  async durableStatsBetween(
    fromExclusive: number,
    toInclusive: number,
  ): Promise<{ firstSeq?: number; lastSeq?: number; count: number }> {
    if (toInclusive <= fromExclusive) return { count: 0 };
    if (this.index?.isHealthy) {
      try {
        return this.index.eventStatsBetween(fromExclusive, toInclusive);
      } catch {
        // Fall back to log scan below.
      }
    }
    let firstSeq: number | undefined;
    let lastSeq: number | undefined;
    let count = 0;
    for (const path of [
      `${this.globalEventsPath()}.1`,
      this.globalEventsPath(),
    ]) {
      await forEachJsonLine<unknown>(path, (raw) => {
        const result = eventEnvelopeSchema.safeParse(raw);
        if (!result.success) return;
        const event = result.data as EventEnvelope;
        if (
          event.durability !== "durable" ||
          event.seq <= fromExclusive ||
          event.seq > toInclusive
        )
          return;
        firstSeq =
          firstSeq === undefined ? event.seq : Math.min(firstSeq, event.seq);
        lastSeq =
          lastSeq === undefined ? event.seq : Math.max(lastSeq, event.seq);
        count += 1;
      });
    }
    return { firstSeq, lastSeq, count };
  }

  async canReplayDurableRange(
    fromSeq: number,
    toSeq: number,
  ): Promise<{
    available: boolean;
    reason?:
      | "cursor_too_old"
      | "cursor_ahead_of_server"
      | "storage_unavailable";
    stats: { firstSeq?: number; lastSeq?: number; count: number };
  }> {
    if (fromSeq > this.#latestDurableSeq) {
      return {
        available: false,
        reason: "cursor_ahead_of_server",
        stats: { count: 0 },
      };
    }
    const stats = await this.durableStatsBetween(fromSeq, toSeq);
    if (stats.count === 0) return { available: true, stats };
    const previous = await this.previousDurableSeqBefore(
      stats.firstSeq ?? toSeq + 1,
    );
    if (previous > fromSeq) {
      return { available: false, reason: "cursor_too_old", stats };
    }
    return { available: true, stats };
  }

  async replayForProtocolSince(
    seq = 0,
    options: ProtocolReplayOptions = {},
  ): Promise<ProtocolReplayResult> {
    const bufferedFloor = this.bufferedFloorSeq();
    const canReplayFromMemory = bufferedFloor === 0 || seq >= bufferedFloor - 1;
    const limitToRange = (events: EventEnvelope[]) =>
      events
        .filter((event) => event.seq > seq)
        .filter(
          (event) => options.toSeq === undefined || event.seq <= options.toSeq,
        )
        .filter(
          (event) =>
            event.durability === "durable" ||
            options.includeTransientIfAvailable,
        )
        .sort((a, b) => a.seq - b.seq);

    if (canReplayFromMemory) {
      return {
        events: limitToRange(this.replaySince(seq)),
        source: "memory",
        replayAvailableFromSeq: bufferedFloor === 0 ? 0 : bufferedFloor - 1,
      };
    }

    const persisted = await this.replayPersistedSinceWithSource(seq);
    return {
      events: limitToRange(persisted.events),
      source: persisted.source,
      replayAvailableFromSeq: 0,
    };
  }

  private async replayPersistedSinceWithSource(
    seq = 0,
  ): Promise<ProtocolReplayResult> {
    if (this.index?.isHealthy) {
      try {
        return {
          events: this.index.eventsSince(seq),
          source: "index",
          replayAvailableFromSeq: 0,
        };
      } catch {
        // Fall back to reading the log file below.
      }
    }
    const events = await readJsonLines<unknown>(this.globalEventsPath()).catch(
      () => [],
    );
    return {
      events: events
        .map((event) => eventEnvelopeSchema.safeParse(event))
        .filter((result) => result.success && result.data.seq > seq)
        .map((result) => result.data as EventEnvelope)
        .sort((a, b) => a.seq - b.seq),
      source: "log",
      replayAvailableFromSeq: 0,
    };
  }

  async removeEventsForConversations(
    conversationIds: Iterable<string>,
  ): Promise<void> {
    const conversations = new Set(conversationIds);
    if (conversations.size === 0) return;
    const keep = (event: EventEnvelope) => {
      const conversationId = conversationIdForEvent(event);
      return !conversationId || !conversations.has(conversationId);
    };
    this.#events = this.#events.filter(keep);
    await filterJsonLinesToFile<EventEnvelope>(
      this.globalEventsPath(),
      keep,
      0o600,
    );
    this.index?.deleteEventsForConversations(conversations);
  }

  subscribe(listener: (event: EventEnvelope) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  private async persist(event: EventEnvelope): Promise<void> {
    const dir = join(this.dataDir, "logs");
    await mkdir(dir, { recursive: true });
    const line = `${JSON.stringify(event)}\n`;
    await this.rotateGlobalLogIfNeeded(line.length);
    await appendFile(this.globalEventsPath(), line, "utf8");
    const conversationId = conversationIdForEvent(event);
    if (conversationId) {
      const conversationDir = join(
        this.dataDir,
        "conversations",
        conversationId,
      );
      await mkdir(conversationDir, { recursive: true });
      await appendFile(join(conversationDir, "events.jsonl"), line, "utf8");
    }
  }

  /**
   * Cap the global event log size. The durable record of truth lives in the
   * index and the per-conversation logs, so the global log only needs to hold a
   * recent tail. When it exceeds the cap it rolls to `events.jsonl.1` (one
   * generation retained), keeping appends and replay bounded.
   */
  private async rotateGlobalLogIfNeeded(nextLineBytes: number): Promise<void> {
    const path = this.globalEventsPath();
    if (!(await pathExists(path))) return;
    const size = await stat(path)
      .then((s) => s.size)
      .catch(() => 0);
    if (size + nextLineBytes <= MAX_GLOBAL_EVENT_LOG_BYTES) return;
    await rename(path, `${path}.1`).catch(() => undefined);
  }

  private globalEventsPath(): string {
    return join(this.dataDir, "logs", "events.jsonl");
  }
}
