import { appendFile, mkdir, rename, stat } from "node:fs/promises";
import { join } from "node:path";
import {
  createId,
  type EventDurability,
  type EventEnvelope,
  eventEnvelopeSchema,
} from "@nerve/shared";
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
    this.#seq += 1;
    const durability = options.durability ?? "durable";
    const event: EventEnvelope<T> = {
      seq: this.#seq,
      id: createId("evt"),
      ts: new Date().toISOString(),
      type,
      durability,
      data,
    };
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
    if (this.index?.isHealthy) {
      try {
        return this.index.eventsSince(seq);
      } catch {
        // Fall back to reading the log file below.
      }
    }
    const events = await readJsonLines<unknown>(this.globalEventsPath()).catch(
      () => [],
    );
    return events
      .map((event) => eventEnvelopeSchema.safeParse(event))
      .filter((result) => result.success && result.data.seq > seq)
      .map((result) => result.data as EventEnvelope)
      .sort((a, b) => a.seq - b.seq);
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
