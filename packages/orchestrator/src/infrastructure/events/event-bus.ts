import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import {
  createId,
  type EventDurability,
  type EventEnvelope,
  eventEnvelopeSchema,
} from "@nerve/shared";
import type { IndexStore } from "../../infrastructure/index-store/index.js";
import { readJsonLines, rewriteJsonLines } from "../storage/index.js";
import { conversationIdForEvent } from "./event-ref-extractor.js";

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

  async hydrate(): Promise<void> {
    const events = await readJsonLines<unknown>(this.globalEventsPath()).catch(
      () => [],
    );
    const parsed = events
      .map((event) => eventEnvelopeSchema.safeParse(event))
      .filter((result) => result.success)
      .map((result) => result.data as EventEnvelope)
      .sort((a, b) => a.seq - b.seq);
    this.#events = parsed.slice(-this.maxBufferedEvents);
    this.#latestDurableSeq = parsed.reduce(
      (max, event) => Math.max(max, event.seq),
      0,
    );
    this.#seq = this.#latestDurableSeq;
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

  replaySince(seq = 0): EventEnvelope[] {
    return this.#events.filter((event) => event.seq > seq);
  }

  async replayPersistedSince(seq = 0): Promise<EventEnvelope[]> {
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
    const persisted = await this.replayPersistedSince(0);
    await rewriteJsonLines(
      this.globalEventsPath(),
      persisted.filter(keep),
      0o600,
    );
  }

  subscribe(listener: (event: EventEnvelope) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  private async persist(event: EventEnvelope): Promise<void> {
    const dir = join(this.dataDir, "logs");
    await mkdir(dir, { recursive: true });
    const line = `${JSON.stringify(event)}\n`;
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

  private globalEventsPath(): string {
    return join(this.dataDir, "logs", "events.jsonl");
  }
}
